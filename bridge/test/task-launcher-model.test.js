import assert from "node:assert/strict"
import test from "node:test"
import { TaskLauncher } from "../src/task-launcher.js"

function task(overrides = {}) {
  return {
    id: "task-12345678",
    agentId: "codex",
    prompt: "Implement the fix",
    model: { providerID: "openai", modelID: "gpt-x", variant: "high" },
    workspace: { mode: "project", path: "/repo" },
    ...overrides
  }
}

test("ACP task launch applies selected model before prompting", async () => {
  const calls = []
  const host = {
    async start() {},
    async request(method, params) {
      calls.push({ method, params })
      if (method === "session/new") {
        return {
          sessionId: "session-1",
          configOptions: [{
            id: "model",
            options: [
              { value: "openai/gpt-y" },
              { value: "openai/gpt-x" }
            ]
          }]
        }
      }
      if (method === "session/set_config_option") return {}
      if (method === "session/prompt") return { stopReason: "end_turn" }
      throw new Error(`unexpected method ${method}`)
    }
  }
  const daemon = {
    hostEntry: () => ({ kind: "acp", host }),
    registry: { host: () => ({ state: "available" }) }
  }
  const launcher = new TaskLauncher({ daemon })
  const selected = task()
  const run = await launcher.createSession(selected)

  assert.equal(run.sessionId, "session-1")
  assert.deepEqual(calls.slice(0, 2), [
    { method: "session/new", params: { cwd: "/repo", mcpServers: [] } },
    {
      method: "session/set_config_option",
      params: { sessionId: "session-1", configId: "model", value: "openai/gpt-x" }
    }
  ])

  await launcher.startPrompt(selected, run)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.at(-1).method, "session/prompt")
})

test("managed HTTP task launch sends selected model and variant", async () => {
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.includes("/session?")) {
      return { ok: true, async json() { return { id: "http-session" } } }
    }
    return { ok: true }
  }
  const host = {
    readinessHost: "127.0.0.1",
    port: 4096,
    username: "harness",
    password: "secret",
    async start() {}
  }
  const daemon = {
    hostEntry: () => ({ kind: "http", host }),
    registry: { host: () => ({ state: "available" }) }
  }
  const launcher = new TaskLauncher({ daemon, fetchImpl })
  const selected = task({ agentId: "opencode" })
  const run = await launcher.createSession(selected)

  const createBody = JSON.parse(requests[0].options.body)
  assert.deepEqual(createBody.model, { providerID: "openai", id: "gpt-x", variant: "high" })
  assert.equal(run.sessionId, "http-session")

  await launcher.startPrompt(selected, run)
  const promptBody = JSON.parse(requests[1].options.body)
  assert.deepEqual(promptBody.model, { providerID: "openai", modelID: "gpt-x" })
  assert.equal(promptBody.variant, "high")
})
