import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { AcpAgentModelCatalog } from "../src/agent-model-catalog.js"

class SharedAcp extends EventEmitter {
  starts = 0
  newCalls = []
  async start() { this.starts += 1 }
  close() {}
  async request(method, params) {
    if (method !== "session/new") throw new Error(`unexpected method ${method}`)
    this.newCalls.push(params.cwd)
    await new Promise((resolve) => setTimeout(resolve, 10))
    return {
      sessionId: "catalog-machine",
      configOptions: [{
        id: "model",
        currentValue: "provider/stable",
        options: [{ value: "provider/stable", name: "stable" }]
      }]
    }
  }
}

test("ACP model catalog stays one single-flight catalog per harness even when callers carry project directories", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-model-machine-scope-"))
  try {
    const agent = new SharedAcp()
    const catalog = new AcpAgentModelCatalog({
      agent,
      agentID: "pi",
      directory: "/projects/default",
      stateDirectory
    })

    const [a, b] = await Promise.all([
      catalog.list({ allowStale: false, directory: "/projects/project-a" }),
      catalog.list({ allowStale: false, directory: "/projects/project-b" })
    ])

    assert.deepEqual(a.models.map((model) => model.modelID), ["stable"])
    assert.deepEqual(b.models.map((model) => model.modelID), ["stable"])
    assert.deepEqual(agent.newCalls, ["/projects/default"])

    const cached = await catalog.list({ allowStale: false, directory: "/another/project" })
    assert.deepEqual(cached.models.map((model) => model.modelID), ["stable"])
    assert.equal(agent.newCalls.length, 1)

    const diagnostics = catalog.diagnostics()
    assert.equal(diagnostics.cachedModels, 1)
    assert.equal(diagnostics.technicalSessionPersisted, true)
    assert.equal(Object.prototype.hasOwnProperty.call(diagnostics, "scopes"), false)
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
