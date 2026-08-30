import test from "node:test"
import assert from "node:assert/strict"
import { mergeReplay } from "../src/acp-service.js"

function envelope(id, role, parts, error) {
  return {
    info: { id, role, sessionID: "session-1", time: { created: 1_000 }, ...(error ? { error } : {}) },
    parts
  }
}

const textPart = (id, text) => ({ id, type: "text", text })
const reasoningPart = (id, text) => ({ id, type: "reasoning", text })
const toolPart = (id, callID) => ({
  id,
  type: "tool",
  tool: "shell",
  callID,
  state: { status: "completed", title: "tool" }
})

test("OMP live reasoning plus text reconciles with text-only replay into one assistant reply", () => {
  const previous = [
    envelope("u1", "user", [textPart("u1t", "Question")]),
    envelope("live-a1", "assistant", [
      reasoningPart("r1", "Checking the transcript."),
      textPart("a1t", "Bridge reply")
    ])
  ]
  const replayed = [
    envelope("ru1", "user", [textPart("ru1t", "Question")]),
    envelope("replay-a1", "assistant", [textPart("ra1t", "Bridge reply")])
  ]

  const merged = mergeReplay(previous, replayed)
  assert.equal(merged.filter((message) => message.info.role === "assistant").length, 1)
  assert.equal(merged.at(-1).info.id, "live-a1")
  assert.ok(merged.at(-1).parts.some((part) => part.type === "reasoning"))
})

test("OMP replay treats split and glued visible text as the same reply", () => {
  const previous = [
    envelope("u1", "user", [textPart("u1t", "Question")]),
    envelope("a1", "assistant", [textPart("a1a", "Paragraph one."), textPart("a1b", " Paragraph two.")])
  ]
  const replayed = [
    envelope("ru1", "user", [textPart("ru1t", "Question")]),
    envelope("ra1", "assistant", [textPart("ra1t", "Paragraph one. Paragraph two.")])
  ]

  const merged = mergeReplay(previous, replayed)
  assert.equal(merged.filter((message) => message.info.role === "assistant").length, 1)
  assert.equal(merged.at(-1).info.id, "a1")
})

test("failed and successful replies with the same visible text remain distinct", () => {
  const failed = envelope("failed", "assistant", [textPart("p1", "Working on it.")], {
    name: "HarnessTurnError",
    message: "rate limited"
  })
  const plain = envelope("plain", "assistant", [textPart("p2", "Working on it.")])

  const merged = mergeReplay([failed], [plain])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].info.error.message, "rate limited")
})

test("poisoned trailing assistant duplicate heals without collapsing activity-only envelopes", () => {
  const poisoned = [
    envelope("u1", "user", [textPart("u1t", "Question")]),
    envelope("activity-r", "assistant", [reasoningPart("r1", "thinking")]),
    envelope("activity-tool", "assistant", [toolPart("t1", "call-1")]),
    envelope("live-a1", "assistant", [reasoningPart("r2", "final check"), textPart("a1t", "Answer")]),
    envelope("ghost-a1", "assistant", [textPart("ga1t", "Answer")])
  ]
  const clean = [
    envelope("ru1", "user", [textPart("ru1t", "Question")]),
    envelope("rr", "assistant", [reasoningPart("rr1", "thinking")]),
    envelope("rt", "assistant", [toolPart("rt1", "call-1")]),
    envelope("ra1", "assistant", [textPart("ra1t", "Answer")])
  ]

  const merged = mergeReplay(poisoned, clean)
  assert.equal(merged.filter((message) => message.parts.some((part) => part.type === "reasoning")).length >= 1, true)
  assert.equal(merged.filter((message) => message.parts.some((part) => part.type === "tool")).length >= 1, true)
  assert.equal(merged.filter((message) => message.parts.some((part) => part.type === "text" && part.text === "Answer")).length, 1)
})

test("legitimate repeated replies separated by user prompts are preserved", () => {
  const conversation = [
    envelope("u1", "user", [textPart("u1t", "Q1")]),
    envelope("a1", "assistant", [textPart("a1t", "Yes")]),
    envelope("u2", "user", [textPart("u2t", "Again")]),
    envelope("a2", "assistant", [textPart("a2t", "Yes")])
  ]
  const replayed = [
    envelope("ru1", "user", [textPart("ru1t", "Q1")]),
    envelope("ra1", "assistant", [textPart("ra1t", "Yes")]),
    envelope("ru2", "user", [textPart("ru2t", "Again")]),
    envelope("ra2", "assistant", [textPart("ra2t", "Yes")])
  ]

  const merged = mergeReplay(conversation, replayed)
  assert.deepEqual(merged.filter((message) => message.info.role === "assistant").map((message) => message.info.id), ["a1", "a2"])
})
