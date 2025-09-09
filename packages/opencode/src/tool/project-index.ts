import { z } from "zod"
import * as fs from "fs/promises"
import * as path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./project-index.txt"
import { App } from "../app/app"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Ripgrep } from "../file/ripgrep"

// Define types for our parsed entities
interface FileMetadata {
  path: string
  relativePath: string
  lineCount: number
  size: number
}

interface SymbolInfo {
  name: string
  symbol_fqn: string
  module_fqn: string
  type: "module" | "class" | "function" | "method"
  signature?: {
    parameters: string[]
    returnType?: string
    decorators: string[]
  }
  visibility: "public" | "private"
  isAsync: boolean
  docstring?: string
  docstring_summary?: string
  location: {
    path: string
    line_start: number
    line_end: number
  }
}

interface Relationship {
  type: "import" | "call" | "inherit" | "override"
  source: string
  target: string
}

interface ProjectIndexResult {
  files: FileMetadata[]
  symbols: SymbolInfo[]
  relationships: Relationship[]
}

const parser = lazy(async () => {
  try {
    const { default: Parser } = await import("tree-sitter")
    const Python = await import("tree-sitter-python")
    const p = new Parser()
    p.setLanguage(Python.language as any)
    return p
  } catch (e) {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    const { default: pythonWasm } = await import("tree-sitter-python/tree-sitter-python.wasm" as string, {
      with: { type: "wasm" },
    })
    const pythonLanguage = await Parser.Language.load(pythonWasm)
    const p = new Parser()
    p.setLanguage(pythonLanguage)
    return p
  }
})

export const ProjectIndexTool = Tool.define("project-index", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The path to the project"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  }),
  async execute(params, _ctx) {
    const app = App.info()
    const projectPath = path.isAbsolute(params.path) ? params.path : path.resolve(app.path.cwd, params.path)
    
    // Verify the path is within the allowed directory
    if (!Filesystem.contains(app.path.cwd, projectPath)) {
      throw new Error(`Path ${projectPath} is not in the current working directory`)
    }

    // Step 1: Scan and filter Python files
    const files = await scanPythonFiles(projectPath)
    
    // Step 2: Parse each Python file and extract entities
    const symbols: SymbolInfo[] = []
    const relationships: Relationship[] = []
    
    for (const file of files) {
      try {
        const fileContent = await fs.readFile(file.path, 'utf-8')
        const fileSymbols = await parsePythonFile(fileContent, file.relativePath)
        symbols.push(...fileSymbols.symbols)
        relationships.push(...fileSymbols.relationships)
      } catch (error) {
        // Log error but continue with other files
        console.error(`Failed to parse ${file.path}:`, error)
      }
    }
    
    const result: ProjectIndexResult = {
      files,
      symbols,
      relationships
    }

    return {
      title: `Project Index: ${params.path}`,
      metadata: result,
      output: JSON.stringify(result, null, 2),
    }
  },
})

async function scanPythonFiles(projectPath: string): Promise<FileMetadata[]> {
  // Use Ripgrep to find all Python files
  const pythonFiles = await Ripgrep.files({
    cwd: projectPath,
    glob: ["**/*.py"],
  })
  
  const files: FileMetadata[] = []
  
  for (const relativePath of pythonFiles) {
    // Skip files that are likely generated or in special directories
    if (relativePath.includes('__pycache__') || 
        relativePath.includes('.pytest_cache') || 
        relativePath.includes('.venv') || 
        relativePath.includes('node_modules')) {
      continue
    }
    
    const fullPath = path.join(projectPath, relativePath)
    
    try {
      // Get file stats
      const stat = await fs.stat(fullPath)
      
      // Skip very large files (>1MB)
      if (stat.size > 1024 * 1024) {
        continue
      }
      
      // Read file to get line count
      const content = await fs.readFile(fullPath, 'utf-8')
      const lineCount = content.split('\n').length
      
      files.push({
        path: fullPath,
        relativePath,
        lineCount,
        size: stat.size,
      })
    } catch (error) {
      // Skip files that can't be read
      console.error(`Failed to read file ${fullPath}:`, error)
    }
  }
  
  return files
}

async function parsePythonFile(content: string, relativePath: string): Promise<{ symbols: SymbolInfo[], relationships: Relationship[] }> {
  try {
    const parserInstance = await parser()
    const tree = parserInstance.parse(content)
    
    const symbols: SymbolInfo[] = []
    const relationships: Relationship[] = []
    
    // Determine module FQN from file path
    let module_fqn = relativePath.replace(/\.py$/, '').replace(/\//g, '.')
    if (module_fqn.endsWith('.__init__')) {
      module_fqn = module_fqn.replace(/\.__init__$/, '')
    }
    
    // Walk the tree to find all relevant nodes
    const visitedNodes = new Set<string>()
    
    function walk(node: any) {
      // Get node ID if available, otherwise use a string representation
      const nodeId = node.id !== undefined ? node.id : `${node.type}-${node.startIndex}-${node.endIndex}`;
      if (visitedNodes.has(nodeId)) return
      visitedNodes.add(nodeId.toString())
      
      // Handle different node types
      switch (node.type) {
        case 'class_definition':
          processClass(node, module_fqn, relativePath, content, symbols, relationships)
          break
        case 'function_definition':
          processFunction(node, module_fqn, relativePath, content, symbols, relationships)
          break
        case 'import_statement':
        case 'import_from_statement':
          processImport(node, module_fqn, relationships)
          break
      }
      
      // Recursively walk children
      if (node.childCount > 0) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) {
            walk(child)
          }
        }
      }
    }
    
    if (tree && tree.rootNode) {
      walk(tree.rootNode)
    }
    
    return { symbols, relationships }
  } catch (error) {
    console.error(`Error parsing Python file ${relativePath}:`, error)
    return { symbols: [], relationships: [] }
  }
}

function processClass(
  node: any,
  module_fqn: string,
  relativePath: string,
  _content: string,
  symbols: SymbolInfo[],
  relationships: Relationship[]
) {
  try {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return
    
    const className = nameNode.text
    const symbol_fqn = `${module_fqn}.${className}`
    
    // Get inheritance information
    const inheritanceNode = node.childForFieldName('superclasses')
    if (inheritanceNode) {
      for (let i = 0; i < inheritanceNode.childCount; i++) {
        const child = inheritanceNode.child(i)
        if (child && child.type === 'identifier') {
          const baseClass = child.text
          relationships.push({
            type: "inherit",
            source: symbol_fqn,
            target: baseClass // This would need to be resolved to a full FQN in a more complete implementation
          })
        }
      }
    }
    
    // Extract docstring if present
    let docstring: string | undefined
    let docstring_summary: string | undefined
    
    const bodyNode = node.childForFieldName('body')
    if (bodyNode && bodyNode.firstChild && bodyNode.firstChild.type === 'expression_statement') {
      const expr = bodyNode.firstChild
      if (expr.firstChild && (expr.firstChild.type === 'string' || expr.firstChild.type === 'string_literal')) {
        docstring = expr.firstChild.text.slice(1, -1) // Remove quotes
        docstring_summary = docstring ? docstring.split('\n')[0] : undefined
      }
    }
    
    symbols.push({
      name: className,
      symbol_fqn,
      module_fqn,
      type: "class",
      visibility: className.startsWith('_') ? 'private' : 'public',
      isAsync: false,
      docstring,
      docstring_summary,
      location: {
        path: relativePath,
        line_start: node.startPosition?.row !== undefined ? node.startPosition.row + 1 : 0,
        line_end: node.endPosition?.row !== undefined ? node.endPosition.row + 1 : 0,
      }
    })
  } catch (error) {
    // Silently ignore errors in processing individual nodes
    console.debug(`Error processing class node: ${error}`)
  }
}

function processFunction(
  node: any,
  module_fqn: string,
  relativePath: string,
  _content: string,
  symbols: SymbolInfo[],
  _relationships: Relationship[]
) {
  try {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return
    
    const functionName = nameNode.text
    const symbol_fqn = `${module_fqn}.${functionName}`
    
    // Check if it's an async function
    const isAsync = node.previousSibling && node.previousSibling.type === 'async'
    
    // Extract parameters
    const parameters: string[] = []
    const parametersNode = node.childForFieldName('parameters')
    if (parametersNode) {
      for (let i = 0; i < parametersNode.childCount; i++) {
        const child = parametersNode.child(i)
        if (child && child.type === 'identifier') {
          parameters.push(child.text)
        }
      }
    }
    
    // Extract decorators
    const decorators: string[] = []
    let currentNode = node.previousSibling
    while (currentNode && currentNode.type === 'decorator') {
      const decoratorName = currentNode.text.replace(/^@/, '')
      decorators.push(decoratorName)
      currentNode = currentNode.previousSibling
    }
    
    // Extract return type annotation
    let returnType: string | undefined
    const returnNode = node.childForFieldName('return_type')
    if (returnNode) {
      returnType = returnNode.text
    }
    
    // Extract docstring if present
    let docstring: string | undefined
    let docstring_summary: string | undefined
    
    const bodyNode = node.childForFieldName('body')
    if (bodyNode && bodyNode.firstChild && bodyNode.firstChild.type === 'expression_statement') {
      const expr = bodyNode.firstChild
      if (expr.firstChild && (expr.firstChild.type === 'string' || expr.firstChild.type === 'string_literal')) {
        docstring = expr.firstChild.text.slice(1, -1) // Remove quotes
        docstring_summary = docstring ? docstring.split('\n')[0] : undefined
      }
    }
    
    symbols.push({
      name: functionName,
      symbol_fqn,
      module_fqn,
      type: functionName.includes('.') ? "method" : "function",
      signature: {
        parameters,
        returnType,
        decorators
      },
      visibility: functionName.startsWith('_') ? 'private' : 'public',
      isAsync,
      docstring,
      docstring_summary,
      location: {
        path: relativePath,
        line_start: node.startPosition?.row !== undefined ? node.startPosition.row + 1 : 0,
        line_end: node.endPosition?.row !== undefined ? node.endPosition.row + 1 : 0,
      }
    })
  } catch (error) {
    // Silently ignore errors in processing individual nodes
    console.debug(`Error processing function node: ${error}`)
  }
}

function processImport(node: any, module_fqn: string, relationships: Relationship[]) {
  try {
    if (node.type === 'import_statement') {
      // Handle regular import statements
      // Try to find dotted_name nodes
      const walkTree = (n: any) => {
        if (n.type === 'dotted_name') {
          relationships.push({
            type: "import",
            source: module_fqn,
            target: n.text
          })
        }
        if (n.childCount > 0) {
          for (let i = 0; i < n.childCount; i++) {
            const child = n.child(i)
            if (child) {
              walkTree(child)
            }
          }
        }
      }
      walkTree(node)
    } else if (node.type === 'import_from_statement') {
      // Handle from ... import ... statements
      const moduleNode = node.childForFieldName('module')
      if (moduleNode) {
        relationships.push({
          type: "import",
          source: module_fqn,
          target: moduleNode.text
        })
      }
    }
  } catch (error) {
    // Silently ignore errors in processing individual nodes
    console.debug(`Error processing import node: ${error}`)
  }
}