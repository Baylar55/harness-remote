import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createBridgeServer } from "../src/server.js"

const SESSION_COUNT = 160

class ManySessionsAcp extends EventEmitter {
  constructor(sessionIDs) {
    super()
    this.sessionIDs = sessionIDs
  }

  async start() {}

  async listSessions() {
    return this.sessionIDs.map((sessionId, index) => ({
      sessionId,
      title: `Historical ${index + 1}`,
      cwd: process.cwd(),
      updatedAt: new Date(Date.UTC(2026, 7, 19, 12, 0, index % 60)).toISOString()
    }))
  }

  async request() {
    throw new Error("TaskDesk metadata pressure paths must not open ACP sessions")
  }

  notify() {}
}

function snapshotName(sessionID) {
  return `${Buffer.from(sessionID).toString("base64url")}.json`
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test("TaskDesk session indexing stays metadata-only under historical snapshot pressure", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "taskdesk-memory-pressure-"))
  const sessionIDs = Array.from({ length: SESSION_COUNT }, (_, index) => `historical-${index + 1}`)

  // Every snapshot is deliberately unreadable. If the Sessions index accidentally falls back to
  // AcpService.listSessions(), each one would be restored and emit session.error. A metadata-only
  // path must ignore them completely, regardless of how much historical state exists on disk.
  await Promise.all(sessionIDs.map((sessionID) =>
    writeFile(path.join(snapshotDirectory, snapshotName(sessionID)), "{not-valid-json", "utf8")
  ))

  const acp = new ManySessionsAcp(sessionIDs)
  const machineRegistry = { snapshot: () => ({ machine: { id: "test", name: "test" }, agents: [] }) }
  const server = createBridgeServer({
    config: {
      backend: "omp",
      host: "127.0.0.1",
      port: 0,
      username: "",
      password: "",
      corsOrigins: [],
      roots: [process.cwd()],
      heartbeatMs: 10_000
    },
    acp,
    machineRegistry,
    serviceOptions: { snapshotDirectory }
  })
  const serviceEvents = []
  const unsubscribe = server.acpService.subscribe((event) => serviceEvents.push(event))

  try {
    const baseURL = await listen(server)

    const sessionsResponse = await fetch(`${baseURL}/experimental/session`)
    assert.equal(sessionsResponse.status, 200)
    const sessions = await sessionsResponse.json()
    assert.equal(sessions.length, SESSION_COUNT)
    assert.equal(serviceEvents.length, 0, "listing sessions must not restore transcript snapshots")

    const statusResponse = await fetch(`${baseURL}/session/status`)
    assert.equal(statusResponse.status, 200)
    const statuses = await statusResponse.json()
    assert.equal(Object.keys(statuses).length, SESSION_COUNT)
    assert.equal(serviceEvents.length, 0, "status reconciliation must remain metadata-only")

    const previewResponse = await fetch(`${baseURL}/session/${sessionIDs[0]}/message?limit=1`)
    assert.equal(previewResponse.status, 200)
    assert.deepEqual(await previewResponse.json(), [])
    assert.equal(serviceEvents.length, 0, "a TaskDesk preview request must not materialize history")

    // Raw ACP listings may keep an old timestamp while a Session is active through this daemon.
    // A lightweight service event must update only the metadata clock, not force transcript reads.
    const beforeActivity = Date.now()
    acp.emit("notification", {
      method: "session/update",
      params: {
        sessionId: sessionIDs[0],
        update: { sessionUpdate: "available_commands_update", availableCommands: [] }
      }
    })
    assert.equal(serviceEvents.at(-1)?.type, "session.updated")

    const activeResponse = await fetch(`${baseURL}/experimental/session`)
    assert.equal(activeResponse.status, 200)
    const activeSessions = await activeResponse.json()
    const recentlyActive = activeSessions.find((session) => session.id === sessionIDs[0])
    assert.ok(recentlyActive.time.updated >= beforeActivity, "live daemon activity must win over a stale ACP listing timestamp")
    assert.equal(serviceEvents.filter((event) => event.type === "session.error").length, 0, "activity sorting must not restore snapshots")

    const diagnosticsResponse = await fetch(`${baseURL}/v1/diagnostics`)
    assert.equal(diagnosticsResponse.status, 200)
    const diagnostics = await diagnosticsResponse.json()
    assert.equal(typeof diagnostics.memory.heapUsed, "number")
    assert.equal(typeof diagnostics.memory.rss, "number")
  } finally {
    unsubscribe()
    if (server.listening) await close(server)
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})
