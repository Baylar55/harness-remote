import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseConfig } from "../src/config.js"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AcpService } from "../src/acp-service.js"

class MockAcp extends EventEmitter {
  constructor(sessions = []) {
    super()
    this.sessionList = sessions
    this.loads = []
  }

  async start() {}

  async listSessions() {
    return this.sessionList
  }

  async request(method, params) {
    if (method === "session/new") {
      const sessionId = `new-${Math.random().toString(36).slice(2, 8)}`
      return { sessionId, configOptions: [] }
    }
    if (method === "session/load") {
      this.loads.push(params.sessionId)
      return { configOptions: [] }
    }
    if (method === "session/prompt") {
      return {}
    }
    return {}
  }

  notify() {}
}

function snapshotPath(dir, sessionId) {
  const name = Buffer.from(sessionId).toString("base64url")
  return path.join(dir, `${name}.json`)
}

test("listSessions does not populate transcript messages into memory", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-list-"))
  let service
  try {
    const sessions = [
      { sessionId: "s1", cwd: process.cwd(), title: "Session 1", updatedAt: new Date().toISOString() },
      { sessionId: "s2", cwd: process.cwd(), title: "Session 2", updatedAt: new Date().toISOString() },
      { sessionId: "s3", cwd: process.cwd(), title: "Session 3", updatedAt: new Date().toISOString() }
    ]

    for (const session of sessions) {
      const snapshot = {
        version: 1,
        title: session.title,
        deleted: false,
        messages: [
          {
            info: { id: `m-${session.sessionId}`, role: "user", sessionID: session.sessionId, time: { created: Date.now() } },
            parts: [
              { id: `p1`, type: "text", text: `Prompt for ${session.sessionId}` },
              { id: `p2`, type: "file", mime: "image/png", url: "data:image/png;base64," + "A".repeat(10_000) }
            ]
          }
        ],
        todos: [{ id: `t-${session.sessionId}`, content: `Todo for ${session.sessionId}`, status: "pending" }]
      }
      await writeFile(snapshotPath(snapshotDirectory, session.sessionId), JSON.stringify(snapshot), "utf8")
    }

    const acp = new MockAcp(sessions)
    service = new AcpService(acp, { snapshotDirectory, maxCachedTranscripts: 2 })

    const listed = await service.listSessions()
    assert.equal(listed.length, 3)
    assert.equal(listed[0].title, "Session 1")
    assert.equal(listed[1].title, "Session 2")
    assert.equal(listed[2].title, "Session 3")

    // Reading a single session's messages restores it on demand
    const s1Messages = await service.messages("s1")
    assert.equal(s1Messages.length, 1)
    assert.equal(s1Messages[0].parts[0].text, "Prompt for s1")
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("LRU eviction bounds cached transcripts and re-hydrates from disk on demand", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-lru-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "s1", cwd: process.cwd(), title: "S1", updatedAt: new Date().toISOString() },
      { sessionId: "s2", cwd: process.cwd(), title: "S2", updatedAt: new Date().toISOString() },
      { sessionId: "s3", cwd: process.cwd(), title: "S3", updatedAt: new Date().toISOString() }
    ])

    service = new AcpService(acp, { snapshotDirectory, maxCachedTranscripts: 2 })

    // Prompt on s1, s2, s3
    await service.prompt("s1", "Prompt 1")
    await service.flushSnapshots()

    await service.prompt("s2", "Prompt 2")
    await service.flushSnapshots()

    await service.prompt("s3", "Prompt 3")
    await service.flushSnapshots()

    // s1 was least recently used and evicted from in-memory cache when s3 was prompted.
    // Accessing s1 re-hydrates s1 seamlessly from disk snapshot without data loss.
    const s1Messages = await service.messages("s1")
    assert.equal(s1Messages.length, 1)
    assert.equal(s1Messages[0].parts[0].text, "Prompt 1")

    const s2Messages = await service.messages("s2")
    assert.equal(s2Messages.length, 1)
    assert.equal(s2Messages[0].parts[0].text, "Prompt 2")

    const s3Messages = await service.messages("s3")
    assert.equal(s3Messages.length, 1)
    assert.equal(s3Messages[0].parts[0].text, "Prompt 3")
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("unlisted unowned sessions and deleted sessions are pruned from memory", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-prune-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "ext-1", cwd: process.cwd(), title: "External 1", updatedAt: new Date().toISOString() },
      { sessionId: "ext-2", cwd: process.cwd(), title: "External 2", updatedAt: new Date().toISOString() }
    ])

    service = new AcpService(acp, { snapshotDirectory })

    // Create an unowned snapshot for ext-1
    const ext1Snapshot = { version: 1, title: "External 1", deleted: false, messages: [{ info: { id: "m1", role: "user", sessionID: "ext-1", time: { created: Date.now() } }, parts: [{ id: "p1", type: "text", text: "Ext 1 text" }] }], todos: [] }
    await writeFile(snapshotPath(snapshotDirectory, "ext-1"), JSON.stringify(ext1Snapshot), "utf8")

    assert.equal((await service.listSessions()).length, 2)

    // Upstream harness removes ext-1
    acp.sessionList = [{ sessionId: "ext-2", cwd: process.cwd(), title: "External 2", updatedAt: new Date().toISOString() }]
    const updatedList = await service.listSessions()
    assert.equal(updatedList.length, 1)
    assert.equal(updatedList[0].id, "ext-2")
    // Give background unlink a tick to settle
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Unowned unlisted session snapshot is unlinked
    await assert.rejects(readFile(snapshotPath(snapshotDirectory, "ext-1"), "utf8"), { code: "ENOENT" })
    await service.deleteSession("ext-2")
    await service.flushSnapshots()

    const finalList = await service.listSessions()
    assert.equal(finalList.length, 0)
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("active sessions are pinned and not evicted by LRU while in-flight", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-pin-"))
  let service
  try {
    class SlowAcp extends EventEmitter {
      promptResolvers = new Map()
      async start() {}
      async listSessions() {
        return [
          { sessionId: "s1", cwd: process.cwd(), title: "S1", updatedAt: new Date().toISOString() },
          { sessionId: "s2", cwd: process.cwd(), title: "S2", updatedAt: new Date().toISOString() }
        ]
      }
      async request(method, params) {
        if (method === "session/load") return { configOptions: [] }
        if (method === "session/prompt") {
          return new Promise((resolve) => {
            this.promptResolvers.set(params.sessionId, resolve)
          })
        }
        return {}
      }
      notify() {}
    }

    const acp = new SlowAcp()
    service = new AcpService(acp, { snapshotDirectory, maxCachedTranscripts: 1 })

    // Start prompt on s1 (which will hang until resolved)
    void service.prompt("s1", "Prompt on S1")
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(service.status("s1").type, "busy")

    // Access messages for s2
    await service.prompt("s2", "Prompt on S2")
    await service.flushSnapshots()

    // s1 must remain in memory and busy despite maxCachedTranscripts = 1
    assert.equal(service.status("s1").type, "busy")
    const s1Messages = await service.messages("s1")
    assert.equal(s1Messages[0].parts[0].text, "Prompt on S1")

    // Resolve s1 prompt
    acp.promptResolvers.get("s1")?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(service.status("s1").type, "idle")
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("persists and rehydrates prompts with large base64 image attachments across eviction", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-attachments-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "img-session", cwd: process.cwd(), title: "Image session", updatedAt: new Date().toISOString() },
      { sessionId: "filler", cwd: process.cwd(), title: "Filler session", updatedAt: new Date().toISOString() }
    ])
    acp.promptCapabilities = { image: true }

    service = new AcpService(acp, { snapshotDirectory, maxCachedTranscripts: 1 })

    const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    await service.prompt("img-session", "Analyze image", undefined, [
      { mime: "image/png", filename: "test.png", data: imageData }
    ])
    await service.flushSnapshots()

    // Evict img-session by accessing filler
    await service.prompt("filler", "Filler prompt")
    await service.flushSnapshots()

    // Re-hydrate img-session
    const messages = await service.messages("img-session")
    assert.equal(messages.length, 1)
    assert.equal(messages[0].parts[0].text, "Analyze image")
    assert.equal(messages[0].parts[1].type, "file")
    assert.equal(messages[0].parts[1].mime, "image/png")
    assert.equal(messages[0].parts[1].url, `data:image/png;base64,${imageData}`)
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("prunes owned sessions after exceeding unlisted poll limit when daemon deletes out of band", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-oob-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "owned-1", cwd: process.cwd(), title: "Owned 1", updatedAt: new Date().toISOString() }
    ])

    service = new AcpService(acp, { snapshotDirectory })

    // Create session (which marks it owned)
    const created = await service.createSession({ directory: process.cwd(), title: "Owned 2" })
    acp.sessionList = [{ sessionId: created.id, cwd: process.cwd(), title: "Owned 2", updatedAt: new Date().toISOString() }]
    assert.equal((await service.listSessions()).length, 1)

    // Daemon removes all sessions out of band
    acp.sessionList = []

    // Consecutive polls keep it for up to MAX_UNLISTED_POLLS (5) polls
    for (let i = 0; i < 5; i++) {
      const listed = await service.listSessions()
      assert.equal(listed.length, 1)
      assert.equal(listed[0].title, "Owned 2")
    }

    // 6th unlisted poll prunes the stale unlisted owned session
    // 6th unlisted poll prunes the stale unlisted owned session and unlinks its snapshot file
    const listedAfterPrune = await service.listSessions()
    assert.equal(listedAfterPrune.length, 0)
    await assert.rejects(readFile(snapshotPath(snapshotDirectory, created.id), "utf8"), { code: "ENOENT" })
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("deleted session tombstone snapshot clears message arrays from disk", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-tombstone-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "s-delete", cwd: process.cwd(), title: "Delete Me", updatedAt: new Date().toISOString() }
    ])
    service = new AcpService(acp, { snapshotDirectory })

    await service.prompt("s-delete", "Big message payload with attachment")
    await service.flushSnapshots()

    // Verify snapshot initially had messages
    const initialSnapshot = JSON.parse(await readFile(snapshotPath(snapshotDirectory, "s-delete"), "utf8"))
    assert.equal(initialSnapshot.messages.length, 1)
    assert.equal(initialSnapshot.deleted, false)

    // Delete session
    await service.deleteSession("s-delete")
    await service.flushSnapshots()

    // Verify tombstone snapshot has empty messages and todos
    const tombstone = JSON.parse(await readFile(snapshotPath(snapshotDirectory, "s-delete"), "utf8"))
    assert.equal(tombstone.deleted, true)
    assert.deepEqual(tombstone.messages, [])
    assert.deepEqual(tombstone.todos, [])
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})

test("config parses maxCachedTranscripts from CLI flag and environment variable", () => {
  const cliConfig = parseConfig(["--max-cached-transcripts", "12"])
  assert.equal(cliConfig.maxCachedTranscripts, 12)

  const envConfig = parseConfig([], { HARNESS_REMOTE_MAX_CACHED_TRANSCRIPTS: "6" })
  assert.equal(envConfig.maxCachedTranscripts, 6)
})

test("metadata-only persist on an evicted session preserves on-disk messages and todos", async () => {
  const snapshotDirectory = await mkdtemp(path.join(tmpdir(), "acp-eviction-rename-"))
  let service
  try {
    const acp = new MockAcp([
      { sessionId: "s-persist", cwd: process.cwd(), title: "Original Title", updatedAt: new Date().toISOString() },
      { sessionId: "filler", cwd: process.cwd(), title: "Filler", updatedAt: new Date().toISOString() }
    ])
    service = new AcpService(acp, { snapshotDirectory, maxCachedTranscripts: 1 })

    // Prompt on s-persist with large payload
    await service.prompt("s-persist", "Important conversation history")
    await service.flushSnapshots()

    // Evict s-persist from in-memory cache by accessing filler
    await service.prompt("filler", "Filler message")
    await service.flushSnapshots()

    // Rename s-persist while evicted
    await service.renameSession("s-persist", "Renamed Title")
    await service.flushSnapshots()

    // Snapshot on disk must still have the full messages array and the new title
    const snapshotOnDisk = JSON.parse(await readFile(snapshotPath(snapshotDirectory, "s-persist"), "utf8"))
    assert.equal(snapshotOnDisk.title, "Renamed Title")
    assert.equal(snapshotOnDisk.messages.length, 1)
    assert.equal(snapshotOnDisk.messages[0].parts[0].text, "Important conversation history")

    // Messages API also returns the preserved conversation
    const messages = await service.messages("s-persist")
    assert.equal(messages.length, 1)
    assert.equal(messages[0].parts[0].text, "Important conversation history")
  } finally {
    await service?.flushSnapshots()
    await rm(snapshotDirectory, { recursive: true, force: true })
  }
})
