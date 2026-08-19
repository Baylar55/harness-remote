import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AcpService } from "../src/acp-service.js"
import { createOmpHistoryLoader } from "../src/omp-session-history.js"
import { createPiHistoryLoader } from "../src/pi-session-history.js"

const SESSION = "01a01000-0000-7000-8000-000000000000"

async function journal(prefix, separator, records) {
  const root = await mkdtemp(path.join(tmpdir(), `harness-${prefix}-`))
  const file = path.join(root, `2026-08-17T16-48-44-623Z${separator}${SESSION}.jsonl`)
  await writeFile(file, records.map((record) => JSON.stringify(record)).join("\n"), "utf8")
  return root
}

const failedTurn = [
  { type: "message", id: "m1", parentId: null, timestamp: "2026-08-17T16:48:45.000Z", message: { role: "user", content: "ciao" } },
  {
    type: "message",
    id: "m2",
    parentId: "m1",
    timestamp: "2026-08-17T16:49:07.000Z",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429 Rate limit exceeded" }
  }
]

test("an OMP turn that failed stays in the transcript with the provider's reason", async () => {
  const root = await journal("omp", "_", failedTurn)
  const messages = await createOmpHistoryLoader(root)(SESSION, { activeSessionLeaf: "m2" })
  assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant"])
  assert.deepEqual(messages[1].parts, [])
  assert.equal(messages[1].info.error?.message, "429 Rate limit exceeded")
  assert.equal(messages[0].info.error, undefined)
})

test("a PI turn that failed stays in the transcript with the provider's reason", async () => {
  const root = await journal("pi", "_", failedTurn)
  const messages = await createPiHistoryLoader(root)(SESSION)
  assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant"])
  assert.equal(messages[1].info.error?.message, "429 Rate limit exceeded")
})

test("a blank errorMessage is not mistaken for a failure worth showing", async () => {
  const root = await journal("pi-blank", "_", [
    failedTurn[0],
    { ...failedTurn[1], message: { role: "assistant", content: [], errorMessage: "   " } }
  ])
  const messages = await createPiHistoryLoader(root)(SESSION)
  assert.deepEqual(messages.map((message) => message.info.role), ["user"])
})

class FailingAcp extends EventEmitter {
  async listSessions() {
    return [{ sessionId: SESSION, cwd: process.cwd(), title: "Failing", updatedAt: new Date().toISOString() }]
  }

  async request(method, params) {
    if (method === "session/load") return { configOptions: [] }
    if (method === "session/prompt") throw new Error("Internal error: provider rejected the request")
    throw new Error(`Unexpected request: ${method}`)
  }

  notify() {}
}

test("a live ACP turn failure is recorded on the transcript, not only announced once", async () => {
  const service = new AcpService(new FailingAcp())
  const errors = []
  service.subscribe((event) => {
    if (event.type === "session.error") errors.push(event.message)
  })
  await service.prompt(SESSION, "ciao")
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(errors, ["Internal error: provider rejected the request"])
  const messages = await service.messages(SESSION)
  assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant"])
  assert.equal(messages[1].info.error?.message, "Internal error: provider rejected the request")
})
