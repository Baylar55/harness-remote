import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { AcpAgentModelCatalog, HttpAgentModelCatalog } from "../src/agent-model-catalog.js"

const never = () => new Promise(() => {})

test("ACP model discovery obeys the catalog-wide timeout budget", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-model-timeout-"))
  try {
    const agent = {
      async start() { await never() },
      async request() { return {} },
      close() {}
    }
    const catalog = new AcpAgentModelCatalog({
      agent,
      agentID: "codex",
      directory: "/repo",
      stateDirectory,
      timeoutMs: 25
    })
    const started = Date.now()
    await assert.rejects(() => catalog.list({ allowStale: false }), /timed out after 25ms/)
    assert.ok(Date.now() - started < 500, "catalog endpoint must not inherit an unbounded ACP startup wait")
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test("HTTP model discovery obeys the same catalog-wide timeout budget", async () => {
  const host = { host: "127.0.0.1", port: 4096, async start() {} }
  const catalog = new HttpAgentModelCatalog({
    host,
    agentID: "opencode",
    fetchImpl: never,
    timeoutMs: 25
  })
  const started = Date.now()
  await assert.rejects(() => catalog.list({ allowStale: false }), /timed out after 25ms/)
  assert.ok(Date.now() - started < 500)
})
