import assert from "node:assert/strict"
import test from "node:test"
import { activityLabel, groupConversationParts } from "./conversation-parts.ts"

function part(id, type, extra = {}) {
  return { id, type, ...extra }
}

test("technical activity absorbs pre-final assistant narration without changing wire order", () => {
  const parts = [
    part("text-1", "text", { text: "I will inspect it." }),
    part("reasoning-1", "reasoning", { text: "Need the component.", time: { start: 1, end: 2 } }),
    part("tool-1", "tool", { tool: "Read", state: { status: "completed" } }),
    part("tool-2", "tool", { tool: "Edit", state: { status: "completed" } }),
    part("text-2", "text", { text: "Fixed." })
  ]

  const groups = groupConversationParts(parts)
  assert.deepEqual(groups.map((group) => group.kind), ["activity", "content"])
  assert.deepEqual(groups.flatMap((group) => group.parts.map((item) => item.id)), parts.map((item) => item.id))
  assert.equal(groups[0].status, "completed")
  assert.equal(activityLabel(groups[0]), "Activity · 2 tools · reasoning · working notes")
  assert.deepEqual(groups[1].parts.map((item) => item.id), ["text-2"])
})

test("assistant narration between technical parts stays inside Activity", () => {
  const parts = [
    part("reasoning-1", "reasoning", { text: "Inspect the file.", time: { start: 1, end: 2 } }),
    part("note", "text", { text: "I found the component, checking the caller now." }),
    part("tool", "tool", { tool: "Read", state: { status: "completed" } }),
    part("final", "text", { text: "Fixed and verified." })
  ]

  const groups = groupConversationParts(parts)
  assert.deepEqual(groups.map((group) => group.kind), ["activity", "content"])
  assert.deepEqual(groups[0].parts.map((item) => item.id), ["reasoning-1", "note", "tool"])
  assert.equal(activityLabel(groups[0]), "Activity · 1 tool · reasoning · working notes")
  assert.deepEqual(groups[1].parts.map((item) => item.id), ["final"])
})

test("plain assistant text with no technical activity remains normal conversation content", () => {
  const groups = groupConversationParts([
    part("text-1", "text", { text: "First paragraph." }),
    part("text-2", "text", { text: "Second paragraph." })
  ])

  assert.deepEqual(groups.map((group) => group.kind), ["content"])
  assert.deepEqual(groups[0].parts.map((item) => item.id), ["text-1", "text-2"])
})

test("an activity group exposes error state without forcing it into normal dialogue", () => {
  const groups = groupConversationParts([
    part("tool-1", "tool", { tool: "Shell", state: { status: "completed" } }),
    part("tool-2", "tool", { tool: "Edit", state: { status: "error", error: "failed" } })
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].kind, "activity")
  assert.equal(groups[0].status, "error")
})

test("running tool activity remains distinct from completed activity", () => {
  const groups = groupConversationParts([
    part("reasoning", "reasoning", { text: "thinking", time: { start: 1, end: 2 } }),
    part("tool", "tool", { tool: "Read", state: { status: "running" } })
  ])

  assert.equal(groups[0].kind, "activity")
  assert.equal(groups[0].status, "running")
})

test("an unfinished reasoning fragment keeps Activity live", () => {
  const groups = groupConversationParts([
    part("reasoning", "reasoning", { text: "still thinking", time: { start: 1 } })
  ])

  assert.equal(groups[0].kind, "activity")
  assert.equal(groups[0].status, "running")
})
