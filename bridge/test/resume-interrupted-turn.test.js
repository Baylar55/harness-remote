import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { AcpService } from "../src/acp-service.js"
import { HARNESS_PROFILES } from "../src/harness-profiles.js"

const SESSION = { sessionId: "claude-session", cwd: process.cwd(), title: "Long task" }

class FakeAcp extends EventEmitter {
  prompts = []
  sessionCapabilities = {}
  promptCapabilities = {}
  constructor(sessions = [SESSION]) {
    super()
    this.sessions = sessions
  }
  async start() {}
  async listSessions() { return this.sessions }
  notify() {}
  request(method, params) {
    if (method !== "session/prompt") return Promise.resolve({})
    return new Promise((resolve, reject) => this.prompts.push({ params, resolve, reject }))
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const promptText = (prompt) => prompt.params.prompt.find((block) => block.type === "text")?.text
const storedTurns = async (directory) => {
  try {
    return JSON.parse(await readFile(path.join(directory, "running-turns.json"), "utf8")).turns
  } catch {
    return []
  }
}

test("Claude resumes the turns a restart interrupted", () => {
  assert.equal(HARNESS_PROFILES.claude.resumeInterruptedTurns, true)
})

test("a turn the adapter was taken away from is prompted again by the next process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-turn-"))
  const before = new FakeAcp()
  const stopped = new AcpService(before, { snapshotDirectory: directory, resumeInterruptedTurns: true })
  await stopped.prompt(SESSION.sessionId, "Refactor everything")
  await settle()
  assert.equal(before.prompts.length, 1)
  before.prompts[0].reject(new Error("ACP adapter closed"))
  await settle()
  assert.deepEqual((await storedTurns(directory)).map((turn) => turn.sessionId), [SESSION.sessionId])

  // A later page of the native list is not loaded at startup; the index still knows the Session.
  const after = new FakeAcp([])
  const restarted = new AcpService(after, { snapshotDirectory: directory, resumeInterruptedTurns: true })
  assert.deepEqual(await restarted.resumeInterruptedTurns(), [SESSION.sessionId])
  await settle()
  assert.equal(after.prompts.length, 1)
  assert.match(promptText(after.prompts[0]), /Continue where you left off/)
  assert.equal(restarted.status(SESSION.sessionId).type, "busy")
  assert.equal((await storedTurns(directory))[0].resumes, 1)

  after.prompts[0].resolve({ stopReason: "end_turn" })
  await settle()
  assert.equal(restarted.status(SESSION.sessionId).type, "idle")
  assert.deepEqual(await storedTurns(directory), [])
  assert.deepEqual(await new AcpService(new FakeAcp(), { snapshotDirectory: directory, resumeInterruptedTurns: true }).resumeInterruptedTurns(), [])
})

test("finished, failed, and cancelled turns are not resumed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-turn-"))
  const acp = new FakeAcp([SESSION, { ...SESSION, sessionId: "failed" }, { ...SESSION, sessionId: "cancelled" }])
  const service = new AcpService(acp, { snapshotDirectory: directory, resumeInterruptedTurns: true })
  await service.prompt(SESSION.sessionId, "Finish")
  await service.prompt("failed", "Fail")
  await service.prompt("cancelled", "Cancel")
  await settle()
  assert.equal((await storedTurns(directory)).length, 3)
  acp.prompts[0].resolve({ stopReason: "end_turn" })
  acp.prompts[1].reject(new Error("Rate limited"))
  service.abort("cancelled")
  await settle()
  assert.deepEqual(await storedTurns(directory), [])
})

test("a turn interrupted on every resume stops being resumed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-turn-"))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const acp = new FakeAcp()
    const service = new AcpService(acp, { snapshotDirectory: directory, resumeInterruptedTurns: true })
    const resumed = await service.resumeInterruptedTurns()
    if (attempt === 0) await service.prompt(SESSION.sessionId, "Crash every time")
    else assert.deepEqual(resumed, attempt <= 3 ? [SESSION.sessionId] : [])
    await settle()
    acp.prompts[0]?.reject(new Error("ACP adapter exited (1)"))
    await settle()
  }
  const last = new AcpService(new FakeAcp(), { snapshotDirectory: directory, resumeInterruptedTurns: true })
  assert.deepEqual(await last.resumeInterruptedTurns(), [])
  assert.deepEqual(await storedTurns(directory), [])
})

test("harnesses that do not opt in keep no running-turn index", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-turn-"))
  const acp = new FakeAcp()
  const service = new AcpService(acp, { snapshotDirectory: directory })
  await service.prompt(SESSION.sessionId, "Work")
  await settle()
  acp.prompts[0].reject(new Error("ACP adapter closed"))
  await settle()
  assert.deepEqual(await storedTurns(directory), [])
  assert.deepEqual(await service.resumeInterruptedTurns(), [])
})
