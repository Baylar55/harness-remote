import assert from "node:assert/strict"
import test from "node:test"
import { activityLabel, groupConversationParts } from "./conversation-parts.ts"

function part(id, type, extra = {}) {
  return { id, type, ...extra }
}

test("technical activity is grouped without changing native wire order", () => {
  const parts = [
    part("text-1", "text", { text: "I will inspect it." }),
    part("reasoning-1", "reasoning", { text: "Need the component." }),
    part("tool-1", "tool", { tool: "Read", state: { status: "completed" } }),
    part("tool-2", "tool", { tool: "Edit", state: { status: "completed" } }),
    part("text-2", "text", { text: "Fixed." })
  ]

  const groups = groupConversationParts(parts)
  assert.deepEqual(groups.map((group) => group.kind), ["content", "activity", "content"])
  assert.deepEqual(groups.flatMap((group) => group.parts.map((item) => item.id)), parts.map((item) => item.id))
  assert.equal(groups[1].status, "completed")
  assert.equal(activityLabel(groups[1]), "Activity · 2 tools · reasoning")
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

test("running activity remains distinct from completed activity", () => {
  const groups = groupConversationParts([
    part("reasoning", "reasoning", { text: "thinking" }),
    part("tool", "tool", { tool: "Read", state: { status: "running" } })
  ])

  assert.equal(groups[0].kind, "activity")
  assert.equal(groups[0].status, "running")
})
