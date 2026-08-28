import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createBridgeServer } from "../src/server.js"

class FakeAcp extends EventEmitter {
  agentInfo = { version: "17.1.3" }
  requests = []

  async start() {}

  async listSessions() {
    return [
      {
        sessionId: "session-to-delete",
        title: "Delete me",
        cwd: process.cwd(),
        updatedAt: "2026-08-28T06:00:00.000Z"
      },
      {
        sessionId: "session-to-keep",
        title: "Keep me",
        cwd: process.cwd(),
        updatedAt: "2026-08-28T06:01:00.000Z"
      }
    ]
  }

  async request(method, params) {
    this.requests.push({ method, params })
    return {}
  }

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

test("ACP deletion disappears from Session-first discovery and survives a daemon restart without mutating the harness", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-remote-delete-"))
  const serviceOptions = { snapshotDirectory: path.join(stateDirectory, "omp") }
  const firstAcp = new FakeAcp()
  const firstServer = createBridgeServer({ config, acp: firstAcp, serviceOptions })
  const firstBase = await listen(firstServer)

  try {
    const beforeResponse = await fetch(`${firstBase}/experimental/session`)
    assert.equal(beforeResponse.status, 200)
    const before = await beforeResponse.json()
    assert.deepEqual(before.map((session) => session.id), ["session-to-delete", "session-to-keep"])

    const deleteResponse = await fetch(`${firstBase}/session/session-to-delete`, { method: "DELETE" })
    assert.equal(deleteResponse.status, 200)
    assert.equal(await deleteResponse.json(), true)

    const afterResponse = await fetch(`${firstBase}/experimental/session`)
    assert.equal(afterResponse.status, 200)
    const after = await afterResponse.json()
    assert.deepEqual(after.map((session) => session.id), ["session-to-keep"])

    const statusResponse = await fetch(`${firstBase}/session/status`)
    assert.equal(statusResponse.status, 200)
    assert.deepEqual(Object.keys(await statusResponse.json()), ["session-to-keep"])

    assert.deepEqual(firstAcp.requests, [])
  } finally {
    await close(firstServer)
  }

  const secondAcp = new FakeAcp()
  const secondServer = createBridgeServer({ config, acp: secondAcp, serviceOptions })
  const secondBase = await listen(secondServer)

  try {
    const restoredResponse = await fetch(`${secondBase}/experimental/session`)
    assert.equal(restoredResponse.status, 200)
    const restored = await restoredResponse.json()
    assert.deepEqual(restored.map((session) => session.id), ["session-to-keep"])

    const fullListResponse = await fetch(`${secondBase}/session`)
    assert.equal(fullListResponse.status, 200)
    const fullList = await fullListResponse.json()
    assert.deepEqual(fullList.map((session) => session.id), ["session-to-keep"])

    assert.deepEqual(secondAcp.requests, [])
  } finally {
    await close(secondServer)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})


test("legacy deleted snapshot is migrated into the persistent Session-first deletion index", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-remote-delete-legacy-"))
  const snapshotDirectory = path.join(stateDirectory, "omp")
  const serviceOptions = { snapshotDirectory }
  const sessionID = "session-to-delete"
  const snapshotName = Buffer.from(sessionID).toString("base64url")
  await mkdir(snapshotDirectory, { recursive: true })
  await writeFile(path.join(snapshotDirectory, `${snapshotName}.json`), JSON.stringify({
    version: 1,
    messages: [],
    todos: [],
    title: "Delete me",
    deleted: true
  }))

  const firstAcp = new FakeAcp()
  const firstServer = createBridgeServer({ config, acp: firstAcp, serviceOptions })
  const firstBase = await listen(firstServer)

  try {
    // The lightweight list intentionally does not read every legacy per-Session snapshot at startup,
    // so this reproduces the real upgrade case: the old tombstone is not known until DELETE touches
    // that Session.
    const beforeResponse = await fetch(`${firstBase}/experimental/session`)
    assert.equal(beforeResponse.status, 200)
    const before = await beforeResponse.json()
    assert.deepEqual(before.map((session) => session.id), ["session-to-delete", "session-to-keep"])

    // Before this regression fix, restoring deleted:true here threw "Harness session not found"
    // before deleted-sessions.json could be written. The Session disappeared only in memory and
    // returned after restart.
    const deleteResponse = await fetch(`${firstBase}/session/${sessionID}`, { method: "DELETE" })
    assert.equal(deleteResponse.status, 200)
    assert.equal(await deleteResponse.json(), true)
    assert.deepEqual(firstAcp.requests, [])
  } finally {
    await close(firstServer)
  }

  const secondAcp = new FakeAcp()
  const secondServer = createBridgeServer({ config, acp: secondAcp, serviceOptions })
  const secondBase = await listen(secondServer)
  try {
    const restoredResponse = await fetch(`${secondBase}/experimental/session`)
    assert.equal(restoredResponse.status, 200)
    const restored = await restoredResponse.json()
    assert.deepEqual(restored.map((session) => session.id), ["session-to-keep"])
    assert.deepEqual(secondAcp.requests, [])
  } finally {
    await close(secondServer)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
