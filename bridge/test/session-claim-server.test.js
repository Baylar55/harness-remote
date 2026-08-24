import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { createSessionClaimServer } from "../src/session-claim-server.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server.address().port
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test("native Session claim targets the exact agent and existing Session id", async () => {
  const calls = []
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    async claimSession(agentID, sessionID) { calls.push([agentID, sessionID]) }
  })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/agents/codex/session/native-123/claim`, { method: "POST" })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { claimed: true, sessionID: "native-123" })
    assert.deepEqual(calls, [["codex", "native-123"]])
  } finally {
    await close(server)
  }
})

test("native writer refusal is a conflict and never falls through to another route", async () => {
  const innerServer = new EventEmitter()
  let delegated = false
  innerServer.on("request", () => { delegated = true })
  const server = createSessionClaimServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    async claimSession() { throw new Error("session is already active in another writer") }
  })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/agents/codex/session/native-locked/claim`, { method: "POST" })
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /active in another writer/)
    assert.equal(delegated, false)
  } finally {
    await close(server)
  }
})

test("unknown agent maps to 404 and unrelated requests delegate unchanged", async () => {
  const innerServer = new EventEmitter()
  innerServer.on("request", (_request, response) => {
    response.writeHead(204)
    response.end()
  })
  const server = createSessionClaimServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    async claimSession() {
      const error = new Error("Unknown agent: missing")
      error.code = "unknown_agent"
      throw error
    }
  })
  const port = await listen(server)
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/v1/agents/missing/session/native-1/claim`, { method: "POST" })
    assert.equal(missing.status, 404)
    const delegated = await fetch(`http://127.0.0.1:${port}/v1/projects`)
    assert.equal(delegated.status, 204)
  } finally {
    await close(server)
  }
})

test("claim route accepts POST only", async () => {
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    async claimSession() {}
  })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/agents/pi/session/native-1/claim`)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST, OPTIONS")
  } finally {
    await close(server)
  }
})
