import { z } from "zod"
import * as fs from "fs/promises"
import * as path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./project-index.txt"
import { App } from "../app/app"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Ripgrep } from "../file/ripgrep"
import { db } from "../util/db/db"
import { symbolsTable, relationshipsTable } from "../util/db/schema"
import { enableDebugLogging, debugLog, errorLog } from "../util/debug"

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
    // Enable debug logging for project indexing
    enableDebugLogging(true)
    debugLog("Starting project indexing", { path: params.path })
    
    const app = App.info()
    const projectPath = path.isAbsolute(params.path) ? params.path : path.resolve(app.path.cwd, params.path)
    debugLog("Resolved project path", { projectPath })
    
    // Verify the path is within the allowed directory
    if (!Filesystem.contains(app.path.cwd, projectPath)) {
      const error = new Error(`Path ${projectPath} is not in the current working directory`)
      errorLog("Path verification failed", error)
      throw error
    }

    // Step 1: Scan and filter Python files
    debugLog("Scanning Python files")
    const files = await scanPythonFiles(projectPath)
    debugLog("Python files scan completed", { fileCount: files.length })
    
    // Step 2: Parse each Python file and extract entities
    const symbols: SymbolInfo[] = []
    const relationships: Relationship[] = []
    
    debugLog("Parsing Python files", { fileCount: files.length })
    for (const file of files) {
      try {
        const fileContent = await fs.readFile(file.path, 'utf-8')
        const fileSymbols = await parsePythonFile(fileContent, file.relativePath)
        symbols.push(...fileSymbols.symbols)
        relationships.push(...fileSymbols.relationships)
      } catch (error) {
        // Silently skip files that can't be parsed
        debugLog("Failed to parse file", { filePath: file.path, error: error instanceof Error ? error.message : String(error) })
      }
    }
    debugLog("All files parsed", { totalSymbols: symbols.length, totalRelationships: relationships.length })
    
    const result: ProjectIndexResult = {
      files,
      symbols,
      relationships
    }

    // Store results in SQLite database
    try {
      debugLog("Storing results in SQLite database")
      // Ensure database tables exist
      debugLog("Database tables ensured")
      
      // Clear existing data for this project
      await db.delete(relationshipsTable);
      debugLog("Cleared existing relationships")
      await db.delete(symbolsTable);
      debugLog("Cleared existing symbols")
      
      // Insert symbols
      if (result.symbols.length > 0) {
        debugLog("Inserting symbols", { count: result.symbols.length })
        // Chunk the symbols into batches to avoid SQLite limits
        const batchSize = 100;
        for (let i = 0; i < result.symbols.length; i += batchSize) {
          const batch = result.symbols.slice(i, i + batchSize);
          await db.insert(symbolsTable).values(
            batch.map(symbol => ({
              name: symbol.name,
              symbol_fqn: symbol.symbol_fqn,
              module_fqn: symbol.module_fqn,
              type: symbol.type,
              visibility: symbol.visibility,
              isAsync: false, // Keep as boolean, Drizzle will handle conversion
              docstring: symbol.docstring,
              docstring_summary: symbol.docstring_summary,
              location_path: symbol.location.path,
              location_line_start: symbol.location.line_start,
              location_line_end: symbol.location.line_end,
              signature_parameters: symbol.signature ? JSON.stringify(symbol.signature.parameters) : null,
              signature_returnType: symbol.signature?.returnType ?? null,
              signature_decorators: symbol.signature ? JSON.stringify(symbol.signature.decorators) : null,
            }))
          ).onConflictDoNothing();
        }
        debugLog("Symbols inserted successfully")
      } else {
        debugLog("No symbols to insert")
      }
      
      // Insert relationships
      if (result.relationships.length > 0) {
        debugLog("Inserting relationships", { count: result.relationships.length })
        // Chunk the relationships into batches to avoid SQLite limits
        const batchSize = 100;
        for (let i = 0; i < result.relationships.length; i += batchSize) {
          const batch = result.relationships.slice(i, i + batchSize);
          await db.insert(relationshipsTable).values(
            batch.map(relationship => ({
              type: relationship.type,
              source: relationship.source,
              target: relationship.target,
            }))
          ).onConflictDoNothing();
        }
        debugLog("Relationships inserted successfully")
      } else {
        debugLog("No relationships to insert")
      }
      
      debugLog("Stored results in database", { 
        symbolsCount: result.symbols.length, 
        relationshipsCount: result.relationships.length 
      });
    } catch (error) {
      errorLog("Failed to store results in database", error)
      // Continue with the operation even if database storage fails
    }

    debugLog("Project indexing completed", { 
      files: result.files.length,
      symbols: result.symbols.length,
      relationships: result.relationships.length
    })
    
    return {
      title: `Project Index: ${params.path}`,
      metadata: result,
      output: JSON.stringify(result, null, 2),
    }
  },
})

async function scanPythonFiles(projectPath: string): Promise<FileMetadata[]> {
  debugLog("Scanning Python files in project path", { projectPath })
  // Use Ripgrep to find all Python files
  const pythonFiles = await Ripgrep.files({
    cwd: projectPath,
    glob: ["**/*.py"],
  })
  debugLog("Found Python files from Ripgrep", { count: pythonFiles.length })
  
  const files: FileMetadata[] = []
  
  for (const relativePath of pythonFiles) {
    // Skip files that are likely generated or in special directories
    if (relativePath.includes('__pycache__') || 
        relativePath.includes('.pytest_cache') || 
        relativePath.includes('.venv') || 
        relativePath.includes('node_modules')) {
      debugLog("Skipping file (special directory)", { relativePath })
      continue
    }
    
    const fullPath = path.join(projectPath, relativePath)
    debugLog("Processing file", { fullPath })
    
    try {
      // Get file stats
      const stat = await fs.stat(fullPath)
      
      // Skip very large files (>1MB)
      if (stat.size > 1024 * 1024) {
        debugLog("Skipping file (too large)", { fullPath, size: stat.size })
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
      debugLog("Added file", { fullPath, lineCount, size: stat.size })
    } catch (error) {
      // Skip files that can't be read
      debugLog("Failed to read file", { fullPath, error: error instanceof Error ? error.message : String(error) })
    }
  }
  
  debugLog("Total files processed", { count: files.length })
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