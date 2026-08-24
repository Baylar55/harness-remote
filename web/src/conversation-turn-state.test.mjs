import assert from "node:assert/strict"
import test from "node:test"
import { assistantTurnAttention, latestConversationAttention } from "./conversation-turn-state.ts"

function envelope(role, parts, options = {}) {
  return {
    info: {
      id: options.id || `${role}-1`,
      role,
      time: { created: options.created || 1 },
      ...(options.error ? { error: options.error } : {})
    },
    parts
  }
}

const reasoning = (id = "reasoning-1") => ({ id, type: "reasoning", text: "working" })
const text = (value, id = "text-1") => ({ id, type: "text", text: value })
const tool = (status = "completed", id = "tool-1") => ({ id, type: "tool", tool: "shell", state: { status } })

test("terminal provider failure becomes Needs attention", () => {
  const message = envelope("assistant", [reasoning()], {
    error: { name: "ProviderError", message: "rate limit exceeded" }
  })
  assert.deepEqual(assistantTurnAttention(message), {
    kind: "failed",
    title: "Turn failed",
    message: "rate limit exceeded"
  })
})

test("a later final answer suppresses stale transport or intermediate errors", () => {
  const message = envelope("assistant", [reasoning(), tool("error"), text("Done successfully", "final")], {
    error: { name: "TransportError", message: "temporary disconnect" }
  })
  assert.equal(assistantTurnAttention(message), null)
})

test("reasoning or tool activity with no final answer becomes interrupted only after work stops", () => {
  const message = envelope("assistant", [reasoning(), tool("completed")])
  assert.equal(assistantTurnAttention(message, { active: true }), null)
  assert.deepEqual(assistantTurnAttention(message), {
    kind: "interrupted",
    title: "Response interrupted",
    message: "The coding agent stopped before producing a final answer."
  })
})

test("latest Session attention is scoped to the latest user turn", () => {
  const oldFailure = envelope("assistant", [reasoning("old")], {
    id: "assistant-old",
    error: { name: "ProviderError", message: "old failure" }
  })
  const latestUser = envelope("user", [text("try again", "user-text")], { id: "user-latest", created: 2 })
  const latestAnswer = envelope("assistant", [text("fixed", "final-answer")], { id: "assistant-latest", created: 3 })
  assert.equal(latestConversationAttention([oldFailure, latestUser, latestAnswer]), null)
})

test("a later assistant final answer wins over earlier activity in the same user turn", () => {
  const user = envelope("user", [text("do it", "user-text")], { id: "user-1" })
  const activity = envelope("assistant", [reasoning("r1"), tool("error", "t1")], { id: "assistant-activity" })
  const finalAnswer = envelope("assistant", [text("recovered and finished", "final")], { id: "assistant-final" })
  assert.equal(latestConversationAttention([user, activity, finalAnswer]), null)
})

test("an open Session never manufactures attention while its native status is active", () => {
  const user = envelope("user", [text("do it")])
  const activity = envelope("assistant", [reasoning(), tool("error")], {
    error: { name: "ToolError", message: "intermediate tool failed" }
  })
  assert.equal(latestConversationAttention([user, activity], { active: true }), null)
})
