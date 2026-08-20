import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AcpService } from "../src/acp-service.js"

class ListingAcp extends EventEmitter {
  constructor(sessions) {
    super()
    this.sessions = sessions
    this.promptCapabilities = {}
  }
  async listSessions() { return this.sessions }
  async start() {}
  async request() { throw new Error("ACP replay should not be needed for authoritative history") }
  notify() {}
}

function transcript(sessionID, text = sessionID) {
  return [{
    info: { id: `${sessionID}:1`, role: "assistant", sessionID, time: { created: 1 } },
    parts: [{ id: `${sessionID}:1:text`, type: "text", text }]
  }]
}

function sessions(count) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `session-${index}`,
    cwd: "/repo",
    updatedAt: `2026-08-20T10:${String(index).padStart(2, "0")}:00.000Z`
  }))
}

test("AcpService retains at most the bounded number of inactive transcripts", async () => {
  const listed = sessions(12)
  const loads = new Map()
  const loader = async (sessionID) => {
    loads.set(sessionID, (loads.get(sessionID) ?? 0) + 1)
    return transcript(sessionID)
  }
  loader.authoritativeHistory = true
  const service = new AcpService(new ListingAcp(listed), { historyLoader: loader })

  for (const session of listed) {
    assert.equal((await service.messages(session.sessionId)).length, 1)
  }

  const stats = service.diagnostics().transcriptCache
  assert.equal(stats.entries <= stats.maxEntries, true)
  assert.equal(stats.maxEntries, 8)
  assert.equal(stats.evictions >= 4, true)
  assert.equal(stats.weight <= stats.maxWeight, true)

  assert.equal((await service.messages("session-0"))[0].info.id, "session-0:1")
  assert.equal(loads.get("session-0"), 2, "an evicted transcript must be reloadable on demand")
})

test("messagePage uses an authoritative branch pager without materializing full history", async () => {
  const sessionID = "omp-paged-session"
  let fullLoads = 0
  let pageOptions
  const loader = async () => {
    fullLoads += 1
    return transcript(sessionID, "full history should not be read")
  }
  loader.pageRequiresActiveLeaf = true
  loader.page = async (_sessionID, options) => {
    pageOptions = options
    return {
      messages: transcript(sessionID, "bounded page"),
      before: "older-cursor",
      hasMore: true
    }
  }
  const actionProviders = [{
    id: "test-authoritative-leaf",
    requiredCommands: [],
    actions: [],
    loadState: async () => ({
      actions: [],
      sessionRevision: "rev-1",
      activeSessionLeaf: "leaf-42"
    })
  }]
  // The first page request starts from a cold service, so session metadata must be listed
  // without opening ACP replay or loading the full journal transcript.
  const service = new AcpService(new ListingAcp([{
    sessionId: sessionID,
    cwd: "/repo",
    updatedAt: "2026-08-20T10:00:00.000Z"
  }]), { historyLoader: loader, actionProviders })

  const page = await service.messagePage(sessionID, { limit: 25 })
  assert.equal(fullLoads, 0, "a bounded page must not call the full journal loader")
  assert.equal(page.messages[0].parts[0].text, "bounded page")
  assert.equal(page.hasMore, true)
  assert.deepEqual(pageOptions, { limit: 25, before: undefined, activeSessionLeaf: "leaf-42" })
})

test("authoritative journal transcripts are not duplicated into bridge snapshots", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "taskdesk-transcript-snapshot-"))
  try {
    const sessionID = "journal-session"
    const loader = async () => transcript(sessionID, "journal owns this transcript")
    loader.authoritativeHistory = true
    const service = new AcpService(new ListingAcp([{ sessionId: sessionID, cwd: "/repo", updatedAt: "2026-08-20T10:00:00.000Z" }]), {
      historyLoader: loader,
      snapshotDirectory: stateDirectory
    })

    assert.equal((await service.messages(sessionID)).length, 1)
    await service.flushSnapshots()

    const snapshotName = `${Buffer.from(sessionID).toString("base64url")}.json`
    const snapshot = JSON.parse(await readFile(path.join(stateDirectory, snapshotName), "utf8"))
    assert.deepEqual(snapshot.messages, [])
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
