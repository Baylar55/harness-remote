import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { AcpAgentModelCatalog } from "../src/agent-model-catalog.js"

class ScopedAcp extends EventEmitter {
  starts = 0
  newCalls = []
  async start() { this.starts += 1 }
  close() {}
  async request(method, params) {
    if (method !== "session/new") throw new Error(`unexpected method ${method}`)
    this.newCalls.push(params.cwd)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const slug = params.cwd.endsWith("project-a") ? "alpha" : params.cwd.endsWith("project-b") ? "beta" : "default"
    return {
      sessionId: `catalog-${slug}`,
      configOptions: [{
        id: "model",
        currentValue: `provider/${slug}`,
        options: [{ value: `provider/${slug}`, name: slug }]
      }]
    }
  }
}

test("ACP model catalogs isolate cache and single-flight by authorized project cwd while sharing one adapter", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-model-scope-"))
  try {
    const agent = new ScopedAcp()
    const catalog = new AcpAgentModelCatalog({
      agent,
      agentID: "pi",
      directory: "/projects/default",
      stateDirectory
    })

    const [a1, a2, b] = await Promise.all([
      catalog.list({ allowStale: false, directory: "/projects/project-a" }),
      catalog.list({ allowStale: false, directory: "/projects/project-a" }),
      catalog.list({ allowStale: false, directory: "/projects/project-b" })
    ])

    assert.deepEqual(a1.models.map((model) => model.modelID), ["alpha"])
    assert.deepEqual(a2.models.map((model) => model.modelID), ["alpha"])
    assert.deepEqual(b.models.map((model) => model.modelID), ["beta"])
    assert.equal(agent.newCalls.filter((cwd) => cwd === "/projects/project-a").length, 1)
    assert.equal(agent.newCalls.filter((cwd) => cwd === "/projects/project-b").length, 1)

    const cachedA = await catalog.list({ allowStale: false, directory: "/projects/project-a" })
    assert.deepEqual(cachedA.models.map((model) => model.modelID), ["alpha"])
    assert.equal(agent.newCalls.length, 2)

    const diagnostics = catalog.diagnostics()
    assert.equal(diagnostics.cacheScope, "project-cwd")
    assert.equal(diagnostics.scopeCount, 2)
    assert.deepEqual(new Set(diagnostics.scopes.map((scope) => scope.directory)), new Set(["/projects/project-a", "/projects/project-b"]))
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
