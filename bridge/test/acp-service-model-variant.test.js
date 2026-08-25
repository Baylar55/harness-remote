import assert from "node:assert/strict"
import test from "node:test"
import { AcpService } from "../src/acp-service.js"

/**
 * A harness legitimately resets dependent controls when the model changes, so the variant must be
 * applied after the model and never underneath a turn that is already running. These are the exact
 * invariants the Session-first prompt path previously broke by issuing its own set_config_option.
 */
class RecordingAcp {
  calls = []
  #listeners = new Set()
  promptCapabilities = {}
  processID = 4242
  constructor({ holdPrompt = false } = {}) {
    this.holdPrompt = holdPrompt
    this.releasePrompt = undefined
  }
  on() { return this }
  off() { return this }
  async start() {}
  close() {}
  diagnostics() { return { processID: this.processID } }
  notify() {}
  async listSessions() { return [{ sessionId: "s1", cwd: "/repo", title: "S1", updatedAt: new Date().toISOString() }] }
  #configOptions() {
    return [
      { id: "model", currentValue: "openai/a", options: [{ value: "openai/a" }, { value: "openai/b" }] },
      { id: "thinking", currentValue: "off", options: [{ value: "off" }, { value: "high" }] }
    ]
  }
  async request(method, params) {
    this.calls.push([method, params?.configId ?? null, params?.value ?? null])
    if (method === "session/load" || method === "session/new") return { sessionId: "s1", configOptions: this.#configOptions() }
    if (method === "session/set_config_option") return { configOptions: this.#configOptions() }
    if (method === "session/prompt") {
      if (this.holdPrompt) await new Promise((resolve) => { this.releasePrompt = resolve })
      return { stopReason: "end_turn" }
    }
    return {}
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
}

function configCalls(acp) {
  return acp.calls.filter(([method]) => method === "session/set_config_option").map(([, configId, value]) => `${configId}=${value}`)
}

test("setModel applies the model before its harness-advertised variant", async () => {
  const acp = new RecordingAcp()
  const service = new AcpService(acp, {})
  await service.setModel("s1", "openai/b", { configId: "thinking", value: "high" })
  assert.deepEqual(configCalls(acp), ["model=openai/b", "thinking=high"])
})

test("setModel refuses a variant the running adapter never advertised", async () => {
  const acp = new RecordingAcp()
  const service = new AcpService(acp, {})
  await assert.rejects(
    service.setModel("s1", "openai/b", { configId: "thinking", value: "invented" }),
    /variant is not available/
  )
  // The model still landed; only the invented variant was refused.
  assert.deepEqual(configCalls(acp), ["model=openai/b"])
})

test("setModel with no variant leaves other config options untouched", async () => {
  const acp = new RecordingAcp()
  const service = new AcpService(acp, {})
  await service.setModel("s1", "openai/b")
  assert.deepEqual(configCalls(acp), ["model=openai/b"])
})

test("a prompt queued behind a running turn defers both model and variant to dequeue", async () => {
  const acp = new RecordingAcp({ holdPrompt: true })
  const service = new AcpService(acp, {})
  const first = service.prompt("s1", "one", "openai/a", [], { configId: "thinking", value: "off" })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const before = configCalls(acp)

  await service.prompt("s1", "two", "openai/b", [], { configId: "thinking", value: "high" })
  // Still running: the queued turn must not have changed the live turn's configuration.
  assert.deepEqual(configCalls(acp), before)

  acp.releasePrompt?.()
  await first
  await new Promise((resolve) => setTimeout(resolve, 20))
  const after = configCalls(acp).slice(before.length)
  assert.deepEqual(after, ["model=openai/b", "thinking=high"])
})
