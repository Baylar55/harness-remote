import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { AcpService } from "../src/acp-service.js"

const SESSION = "codex-task-session"

function journalMessage(id, role, text, created) {
  return {
    info: { id, role, sessionID: SESSION, time: { created } },
    parts: [{ id: `${id}:text:0`, messageID: id, type: "text", text }]
  }
}

class LockedAcp extends EventEmitter {
  constructor() {
    super()
    this.loads = []
  }

  async listSessions() {
    return [{ sessionId: SESSION, cwd: process.cwd(), title: "Task run", updatedAt: new Date().toISOString() }]
  }

  async request(method, params) {
    if (method === "session/load") {
      this.loads.push(params.sessionId)
      // Codex holds a single-writer lock for as long as any client keeps the thread open.
      throw new Error(`thread ${params.sessionId} already has an active writer`)
    }
    if (method === "session/prompt") return {}
    throw new Error(`Unexpected request: ${method}`)
  }

  notify() {}
}

function historyLoader(messages) {
  const loader = async () => messages
  return loader
}

test("an adopted task session reads the harness journal instead of the recorded prompt alone", async () => {
  const journal = [
    journalMessage("j1", "user", "Salutami", 1_000),
    journalMessage("j2", "assistant", "Ciao!", 2_000),
    journalMessage("j3", "user", "ci sei?", 3_000),
    journalMessage("j4", "assistant", "Sì, ci sono", 4_000)
  ]
  const acp = new LockedAcp()
  const service = new AcpService(acp, { historyLoader: historyLoader(journal) })

  assert.equal(await service.adoptTaskSession(SESSION, { title: "Salutami", prompt: "Salutami" }), true)

  const messages = await service.messages(SESSION)
  assert.deepEqual(
    messages.map((message) => [message.info.role, message.parts.map((part) => part.text).join("")]),
    [["user", "Salutami"], ["assistant", "Ciao!"], ["user", "ci sei?"], ["assistant", "Sì, ci sono"]]
  )
  // The prompt recorded at adoption must not survive alongside the journal's copy of itself.
  assert.equal(messages.filter((message) => message.parts.some((part) => part.text === "Salutami")).length, 1)
  // Adoption exists so a locked thread can be prompted without session/load; reading history
  // must not reintroduce that request.
  assert.deepEqual(acp.loads, [])
})

test("an adopted session keeps picking up journal entries written while the daemon was idle", async () => {
  const journal = [journalMessage("j1", "user", "first", 1_000)]
  const acp = new LockedAcp()
  const service = new AcpService(acp, { historyLoader: async () => journal })
  await service.adoptTaskSession(SESSION, { prompt: "first" })
  assert.equal((await service.messages(SESSION)).length, 1)

  journal.push(journalMessage("j2", "assistant", "answered later", 2_000))
  assert.deepEqual(
    (await service.messages(SESSION)).map((message) => message.info.id),
    ["j1", "j2"]
  )
})

test("an adopted session stays listed as the app's own rather than as an external one", async () => {
  const service = new AcpService(new LockedAcp(), { historyLoader: async () => [] })
  await service.adoptTaskSession(SESSION, { prompt: "task prompt" })
  const [session] = await service.listSessions()
  assert.equal(session.external, undefined)
})

test("a session this bridge prompts stops deferring to the journal", async () => {
  const journal = [journalMessage("j1", "user", "task prompt", 1_000)]
  const acp = new LockedAcp()
  const service = new AcpService(acp, { historyLoader: async () => journal })
  await service.adoptTaskSession(SESSION, { prompt: "task prompt" })
  await service.messages(SESSION)

  await service.prompt(SESSION, "live follow-up")
  // The journal loses the conversation, as a harness rewriting its own branch would: the live
  // transcript is authoritative from the first turn this process runs, so nothing disappears.
  journal.length = 0
  const messages = await service.messages(SESSION)
  assert.deepEqual(
    messages.map((message) => message.parts.map((part) => part.text).join("")),
    ["task prompt", "live follow-up"]
  )
  assert.deepEqual(acp.loads, [])
})

test("a harness with no journal still replays an adopted session over ACP", async () => {
  const replays = []
  class ReplayAcp extends EventEmitter {
    async listSessions() {
      return [{ sessionId: SESSION, cwd: process.cwd(), title: "Task run", updatedAt: new Date().toISOString() }]
    }

    async request(method, params) {
      if (method !== "session/load") throw new Error(`Unexpected request: ${method}`)
      replays.push(params.sessionId)
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: "user_message_chunk", messageId: "u1", content: { type: "text", text: "task prompt" } }
        }
      })
      this.emit("notification", {
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", messageId: "a1", content: { type: "text", text: "replayed answer" } }
        }
      })
      return { configOptions: [] }
    }
  }

  const service = new AcpService(new ReplayAcp())
  await service.adoptTaskSession(SESSION, { prompt: "task prompt" })
  const messages = await service.messages(SESSION)
  assert.deepEqual(replays, [SESSION])
  assert.deepEqual(
    messages.map((message) => [message.info.role, message.parts.map((part) => part.text).join("")]),
    [["user", "task prompt"], ["assistant", "replayed answer"]]
  )
})
