import { Log } from "../util/log"

// Create a dedicated logger for debugging project indexing
const debugLogger = Log.create({ service: "project-index-debug" })

// Flag to control debug logging
let debugEnabled = false

// Function to enable or disable debug logging
export function enableDebugLogging(enabled: boolean) {
  debugEnabled = enabled
}

// Debug logging function that only outputs when debug is enabled
export function debugLog(message: string, extra?: Record<string, any>) {
  if (debugEnabled) {
    debugLogger.info(message, extra)
  }
}

// Error logging function that always outputs errors
export function errorLog(message: string, error?: any) {
  debugLogger.error(message, error ? { error } : undefined)
}