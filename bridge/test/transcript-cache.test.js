import assert from "node:assert/strict"
import test from "node:test"
import { TranscriptCache, transcriptWeight } from "../src/transcript-cache.js"

function message(id, text) {
  return {
    info: { id, role: "assistant", sessionID: "session", time: { created: 1 } },
    parts: [{ id: `${id}:text`, type: "text", text }]
  }
}

test("transcript cache evicts least recently used inactive sessions by entry count", () => {
  const cache = new TranscriptCache({ maxEntries: 2, maxWeight: 1_000_000 })
  cache.set("a", [message("a", "a")])
  cache.set("b", [message("b", "b")])
  assert.ok(cache.get("a"))
  cache.set("c", [message("c", "c")])

  assert.equal(cache.has("a"), true)
  assert.equal(cache.has("b"), false)
  assert.equal(cache.has("c"), true)
  assert.equal(cache.stats().evictions, 1)
})

test("transcript cache protects active sessions and evicts inactive history first", () => {
  const protectedSessions = new Set(["active"])
  const cache = new TranscriptCache({
    maxEntries: 2,
    maxWeight: 1_000_000,
    isProtected: (sessionID) => protectedSessions.has(sessionID)
  })
  cache.set("active", [message("active", "working")])
  cache.set("old", [message("old", "history")])
  cache.set("new", [message("new", "history")])

  assert.equal(cache.has("active"), true)
  assert.equal(cache.has("old"), false)
  assert.equal(cache.has("new"), true)
})

test("transcript weight reflects large text and refresh observes in-place growth", () => {
  const transcript = [message("m1", "short")]
  const initialWeight = transcriptWeight(transcript)
  const cache = new TranscriptCache({ maxEntries: 4, maxWeight: initialWeight + 500 })
  cache.set("first", transcript)
  cache.set("second", [message("m2", "small")])
  transcript[0].parts[0].text += "x".repeat(2_000)

  cache.get("first")
  const stats = cache.stats()
  assert.equal(cache.has("second"), false)
  assert.equal(cache.has("first"), true)
  assert.equal(stats.weight >= transcriptWeight(transcript), true)
})
