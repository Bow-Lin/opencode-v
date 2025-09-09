import { z } from "zod"

import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"
import { lazy } from "../util/lazy"


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
      description: z
        .string()
        .describe(
          "",
        ),
    }),
    async execute(params, ctx) {
      const app = App.info()
      const tree = await parser().then((p) => p.parse(params.path))
      return {
        title: params.path,
        metadata: {
          app,
          tree,
          ctx,
        },
        output: tree.toString(),
      }
    },
  })