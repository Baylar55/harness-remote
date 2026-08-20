import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { createBridgeServer } from "../src/server.js"

class PerformanceAcp extends EventEmitter {
  agentInfo = { version: "test" }
  promptCapabilities = {}
  loadCount = 0

  async start() {}

  async listSessions() {
    return [{
      sessionId: "session-1",
      title: "Long session",
      cwd: process.cwd(),
      updatedAt: "2026-08-19T18:00:00.000Z"
    }]
  }

  async request(method, params) {
    if (method !== "session/load") return {}
    this.loadCount += 1
    for (let index = 1; index <= 4; index += 1) {
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: index % 2 === 1 ? "user_message_chunk" : "agent_message_chunk",
            messageId: `message-${index}`,
            content: { type: "text", text: `message ${index}` }
          }
        }
      })
    }
    return { configOptions: [] }
  }

  notify() {}
}

function authHeaders() {
  return { authorization: `Basic ${Buffer.from("harness:testpw").toString("base64")}` }
}

async function startServer() {
  const acp = new PerformanceAcp()
  const machineRegistry = {
    snapshot() {
      return { machine: { id: "machine-1", name: "Test machine" }, agents: [] }
    }
  }
  const server = createBridgeServer({
    acp,
    machineRegistry,
    config: {
      backend: "omp",
      host: "127.0.0.1",
      port: 0,
      username: "harness",
      password: "testpw",
      roots: [process.cwd()]
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

async function getJSON(baseURL, path) {
  const response = await fetch(`${baseURL}${path}`, { headers: authHeaders() })
  return { response, body: await response.json() }
}

test("TaskDesk session index and status reads do not load transcript history", async () => {
  const bridge = await startServer()
  try {
    const listing = await getJSON(bridge.baseURL, "/experimental/session")
    assert.equal(listing.response.status, 200)
    assert.equal(listing.body.length, 1)
    assert.equal(listing.body[0].id, "session-1")

    const statuses = await getJSON(bridge.baseURL, "/session/status")
    assert.equal(statuses.response.status, 200)
    assert.equal(statuses.body["session-1"].type, "idle")
    assert.equal(bridge.acp.loadCount, 0, "index and status reads must stay metadata-only")
  } finally {
    await bridge.close()
  }
})

test("TaskDesk preview requests never materialize an ACP transcript", async () => {
  const bridge = await startServer()
  try {
    const preview = await getJSON(bridge.baseURL, "/session/session-1/message?limit=1")
    assert.equal(preview.response.status, 200)
    assert.deepEqual(preview.body, [])
    assert.equal(bridge.acp.loadCount, 0)
  } finally {
    await bridge.close()
  }
})

test("message limits bound the response once a transcript is explicitly opened", async () => {
  const bridge = await startServer()
  try {
    const result = await getJSON(bridge.baseURL, "/session/session-1/message?limit=2&refresh=1")
    assert.equal(result.response.status, 200)
    assert.equal(result.body.length, 2)
    assert.deepEqual(result.body.map((message) => message.parts[0].text), ["message 3", "message 4"])
    assert.equal(bridge.acp.loadCount, 1)

    const invalid = await getJSON(bridge.baseURL, "/session/session-1/message?limit=0")
    assert.equal(invalid.response.status, 400)
    assert.match(invalid.body.error, /positive integer/)
  } finally {
    await bridge.close()
  }
})

test("daemon diagnostics expose process memory for soak testing", async () => {
  const bridge = await startServer()
  try {
    const result = await getJSON(bridge.baseURL, "/v1/diagnostics")
    assert.equal(result.response.status, 200)
    assert.equal(typeof result.body.pid, "number")
    assert.equal(typeof result.body.uptimeSeconds, "number")
    for (const key of ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"]) {
      assert.equal(typeof result.body.memory[key], "number", `memory.${key} must be numeric`)
    }
  } finally {
    await bridge.close()
  }
})
