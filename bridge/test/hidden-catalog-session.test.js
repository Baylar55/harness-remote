import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { createBridgeServer } from "../src/server.js"

class FakeAcp extends EventEmitter {
  agentInfo = { version: "test" }
  async start() {}
  async listSessions() {
    return [
      { sessionId: "catalog-session", title: "Catalog", cwd: process.cwd(), updatedAt: "2026-08-16T00:00:00.000Z" },
      { sessionId: "user-session", title: "User", cwd: process.cwd(), updatedAt: "2026-08-16T00:00:01.000Z" }
    ]
  }
  async request() { return {} }
  notify() {}
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const config = {
  backend: "omp",
  username: "",
  password: "",
  corsOrigins: [],
  roots: [process.cwd()]
}

test("catalog sessions are hidden from public session and status endpoints", async () => {
  const hiddenSessionIDs = new Set(["catalog-session"])
  const server = createBridgeServer({ config, acp: new FakeAcp(), serviceOptions: { hiddenSessionIDs } })
  const base = await listen(server)
  try {
    const sessionsResponse = await fetch(`${base}/session`)
    assert.equal(sessionsResponse.status, 200)
    const sessions = await sessionsResponse.json()
    assert.deepEqual(sessions.map((session) => session.id), ["user-session"])

    const statusResponse = await fetch(`${base}/session/status`)
    assert.equal(statusResponse.status, 200)
    const statuses = await statusResponse.json()
    assert.deepEqual(Object.keys(statuses), ["user-session"])
  } finally {
    await close(server)
  }
})
