import { ProjectIndexTool } from "../../src/tool/project-index"
import { App } from "../../src/app/app" 

async function testProjectIndex() {
  try {
    console.log("Testing ProjectIndexTool...")

    await App.provide({ cwd: process.cwd() }, async () => {
    // Create a mock context
        const mockContext: any = {
        sessionID: "test-session",
        messageID: "test-message",
        agent: "test-agent",
        abort: new AbortController().signal,
        metadata: () => {}
        }

        // Test the tool with our test module
        const result = await ProjectIndexTool.init().then(init =>
        init.execute({ path: ".", timeout: 10000 }, mockContext)
        )

        console.log("Project Index Result:")
        console.log(result.output)
    })
  } catch (error) {
    console.error("Error testing ProjectIndexTool:", error)
  }
}

testProjectIndex()