import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { z } from "zod"
import { data } from "./models-macro" with { type: "macro" }

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")
  // Use local model-api.json file in project root
  const localModelApiPath = path.join(process.cwd(), "model-api.json")

  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      tool_call: z.boolean(),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      }),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      options: z.record(z.any()),
    })
    .openapi({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Provider = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      models: z.record(Model),
    })
    .openapi({
      ref: "Provider",
    })

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    // Try to read from local model-api.json first
    const localFile = Bun.file(localModelApiPath)
    const localResult = await localFile.json().catch(() => {})
    if (localResult) {
      log.info("Using local model-api.json", {
        file: localModelApiPath,
      })
      return localResult as Record<string, Provider>
    }

    // Fallback to cache file
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    if (result) return result as Record<string, Provider>
    
    // Last fallback to macro (which will also read local file)
    const json = await data()
    return JSON.parse(json) as Record<string, Provider>
  }

  export async function refresh() {
    // Read from local model-api.json and update cache
    const localFile = Bun.file(localModelApiPath)
    const cacheFile = Bun.file(filepath)
    
    log.info("refreshing from local model-api.json", {
      localFile: localModelApiPath,
      cacheFile: filepath,
    })
    
    const localResult = await localFile.json().catch((e) => {
      log.error("Failed to read local model-api.json", {
        error: e,
        file: localModelApiPath,
      })
      return null
    })
    
    if (localResult) {
      await Bun.write(cacheFile, JSON.stringify(localResult, null, 2))
      log.info("Successfully updated cache from local model-api.json")
    }
  }
}

// Remove the automatic refresh interval since we're using local file
// setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
