import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import path from "node:path"
import test from "node:test"
import { createBridgeServer } from "../src/server.js"
import { OmpService } from "../src/omp-service.js"

class FakeAcp extends EventEmitter {
  agentInfo = { version: "17.0.7" }
  starts = 0
  loadStarts = 0
  #resolveLoadStarted
  #releaseLoad
  loadStarted = new Promise((resolve) => {
    this.#resolveLoadStarted = resolve
  })

  async start() {
    this.starts += 1
  }

  async listSessions() {
    return [{ sessionId: "session-1", title: "Test", cwd: process.cwd(), updatedAt: "2026-07-22T00:00:00.000Z" }]
  }

  async request(method) {
    if (method !== "session/load") return {}
    this.loadStarts += 1
    if (this.loadStarts === 1) {
      this.#resolveLoadStarted()
      await new Promise((resolve) => {
        this.#releaseLoad = resolve
      })
    }
    return {
      configOptions: [{
        id: "model",
        currentValue: "omp/default",
        options: [{ value: "omp/default", name: "OMP Default" }]
      }]
    }
  }

  releaseLoad() {
    this.#releaseLoad?.()
  }

  notify() {}
}

class ReplayAcp extends EventEmitter {
  agentInfo = { version: "17.0.8" }
  session = { sessionId: "session-1", title: "Persisted", cwd: process.cwd(), updatedAt: "2026-07-23T00:00:00.000Z" }

  async start() {}

  async listSessions() {
    return [this.session]
  }

  async request(method) {
    if (method === "session/load") {
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: "persisted-user",
            content: { type: "text", text: "Persist this prompt" }
          }
        }
      })
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "persisted-assistant",
            content: { type: "text", text: "Persist this response" }
          }
        }
      })
    }
    return {}
  }

  notify() {}
}

class FreshnessAcp extends EventEmitter {
  agentInfo = { version: "17.0.8" }
  revision = "2026-07-23T00:00:00.000Z"
  loadStarts = 0
  history = [
    { role: "user", id: "first-user", text: "First prompt" },
    { role: "assistant", id: "first-assistant", text: "First response" }
  ]

  async start() {}


  async listSessions() {
    return [{ sessionId: "session-1", title: "Freshness", cwd: process.cwd(), updatedAt: this.revision }]
  }

  async request(method) {
    if (method === "session/load") {
      this.loadStarts += 1
      this.#replay(this)
    }
    return {}
  }

  #replay() {
    for (const message of this.history) {
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: message.role === "assistant" ? "agent_message_chunk" : "user_message_chunk",
            messageId: message.id,
            content: { type: "text", text: message.text }
          }
        }
      })
    }
  }

  advance() {
    this.revision = "2026-07-23T00:01:00.000Z"
    this.history.push(
      { role: "user", id: "second-user", text: "Second prompt" },
      { role: "assistant", id: "second-assistant", text: "Second response" }
    )
  }

  appendWithoutRevision() {
    this.history.push(
      { role: "user", id: "third-user", text: "Third prompt" },
      { role: "assistant", id: "third-assistant", text: "Third response" }
    )
  }

  notify() {}
}

async function startServer({ acp = new FakeAcp(), ...options } = {}) {
  const server = createBridgeServer({
    acp,
    config: {
      host: "127.0.0.1",
      port: 0,
      username: "omp",
      password: "secret",
      roots: [process.cwd()],
      ...options
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  return {
    acp,
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function authHeaders() {
  return { authorization: `Basic ${Buffer.from("omp:secret").toString("base64")}` }
}

test("requires Basic Auth before exposing bridge endpoints", async () => {
  const bridge = await startServer()
  try {
    const response = await fetch(`${bridge.baseURL}/global/health`)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("www-authenticate"), 'Basic realm="OMP Bridge"')
  } finally {
    await bridge.close()
  }
})

test("serves health and OpenCode-compatible sessions with authentication", async () => {
  const bridge = await startServer()
  try {
    const health = await fetch(`${bridge.baseURL}/global/health`, { headers: authHeaders() })
    assert.deepEqual(await health.json(), { healthy: true, backend: "omp", version: "17.0.7" })
    const sessions = await fetch(`${bridge.baseURL}/session`, { headers: authHeaders() })
    const body = await sessions.json()
    assert.equal(body.length, 1)
    assert.equal(body[0].id, "session-1")
    assert.equal(body[0].status, "idle")
  } finally {
    await bridge.close()
  }
})

test("confines file browsing to configured roots", async () => {
  const bridge = await startServer()
  try {
    const allowed = await fetch(`${bridge.baseURL}/file?path=${encodeURIComponent(process.cwd())}`, { headers: authHeaders() })
    assert.equal(allowed.status, 200)
    const outside = await fetch(`${bridge.baseURL}/file?path=${encodeURIComponent(path.dirname(process.cwd()))}`, { headers: authHeaders() })
    assert.equal(outside.status, 400)
    assert.match((await outside.json()).error, /configured --root boundary/)
  } finally {
    await bridge.close()
  }
})

test("waits for a concurrent ACP session load before returning configured models", async () => {
  const bridge = await startServer()
  try {
    const messages = fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    await bridge.acp.loadStarted

    let modelsSettled = false
    const models = fetch(`${bridge.baseURL}/config/providers?directory=${encodeURIComponent(process.cwd())}&sessionID=session-1`, { headers: authHeaders() })
      .then(async (response) => {
        modelsSettled = true
        return response.json()
      })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(modelsSettled, false)

    bridge.acp.releaseLoad()
    assert.deepEqual(await models, {
      providers: [{
        id: "omp",
        name: "omp",
        models: {
          default: { id: "default", name: "OMP Default", status: "active" }
        }
      }],
      default: { omp: "default" }
    })
    await messages
    assert.equal(bridge.acp.loadStarts, 1)
  } finally {
    bridge.acp.releaseLoad()
    await bridge.close()
  }
})

test("records the submitted user prompt before asynchronous ACP assistant updates", async () => {
  const bridge = await startServer()
  try {
    const prompt = fetch(`${bridge.baseURL}/session/session-1/prompt_async`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: "Explain the fix" }] })
    })
    await bridge.acp.loadStarted
    bridge.acp.releaseLoad()
    assert.equal((await prompt).status, 200)

    bridge.acp.emit("notification", {
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "acp-assistant-message",
          content: { type: "text", text: "The messages are now ordered." }
        }
      }
    })
    bridge.acp.emit("notification", {
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "acp-user-message",
          content: { type: "text", text: "Explain the fix" }
        }
      }
    })

    const messages = await fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    assert.deepEqual((await messages.json()).map((message) => ({
      role: message.info.role,
      text: message.parts[0].text
    })), [
      { role: "user", text: "Explain the fix" },
      { role: "assistant", text: "The messages are now ordered." }
    ])
  } finally {
    bridge.acp.releaseLoad()
    await bridge.close()
  }
})

test("replays persistent user and assistant history when reopening an OMP session", async () => {
  const bridge = await startServer({ acp: new ReplayAcp() })
  try {
    const response = await fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    assert.deepEqual((await response.json()).map((message) => ({
      role: message.info.role,
      text: message.parts[0].text
    })), [
      { role: "user", text: "Persist this prompt" },
      { role: "assistant", text: "Persist this response" }
    ])
  } finally {
    await bridge.close()
  }
})

test("does not publish replay notifications as live session activity", async () => {
  const acp = new ReplayAcp()
  const omp = new OmpService(acp)
  const events = []
  omp.subscribe((event) => events.push(event))
  const originalUpdatedAt = acp.session.updatedAt

  await omp.messages("session-1", true)

  assert.equal(acp.session.updatedAt, originalUpdatedAt)
  assert.deepEqual(events, [])
})

test("keeps the persisted snapshot stable until an explicit history refresh", async () => {
  const acp = new FreshnessAcp()
  const bridge = await startServer({ acp })
  try {
    const first = await fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    assert.equal((await first.json()).length, 2)
    assert.equal(acp.loadStarts, 1)

    acp.advance()
    const backgroundPoll = await fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    assert.deepEqual((await backgroundPoll.json()).map((message) => message.parts[0].text), [
      "First prompt",
      "First response"
    ])
    assert.equal(acp.loadStarts, 1)

    const reopened = await fetch(`${bridge.baseURL}/session/session-1/message?refresh=1`, { headers: authHeaders() })
    assert.deepEqual((await reopened.json()).map((message) => message.parts[0].text), [
      "First prompt",
      "First response",
      "Second prompt",
      "Second response"
    ])
    assert.equal(acp.loadStarts, 2)

    acp.appendWithoutRevision()
    const unchangedRevision = await fetch(`${bridge.baseURL}/session/session-1/message`, { headers: authHeaders() })
    assert.deepEqual((await unchangedRevision.json()).map((message) => message.parts[0].text), [
      "First prompt",
      "First response",
      "Second prompt",
      "Second response"
    ])
    assert.equal(acp.loadStarts, 2)
  } finally {
    await bridge.close()
  }
})
