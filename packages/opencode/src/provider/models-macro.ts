import path from "path"

export async function data() {
  // Read from local model-api.json file in project root
  const localModelApiPath = path.join(process.cwd(), "model-api.json")
  const localFile = Bun.file(localModelApiPath)
  
  try {
    const json = await localFile.text()
    return json
  } catch (e) {
    // If local file doesn't exist or can't be read, return empty object
    console.warn(`Failed to read local model-api.json: ${e}`)
    return "{}"
  }
}
