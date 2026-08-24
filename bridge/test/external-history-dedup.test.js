import assert from "node:assert/strict"
import test from "node:test"
import { mergeExternalHistory, mergeReplay } from "../src/acp-service.js"

function message(id, text, created, extras = {}) {
  return {
    info: { id, role: "user", sessionID: "session-1", time: { created } },
    parts: [{ id: `${id}:text`, messageID: id, type: "text", text, ...extras }]
  }
}

test("deduplicates replayed messages even when ids and timestamps differ", () => {
  const persisted = [message("persisted-1", "same prompt", 1_000)]
  const cached = [message("replayed-1", "same prompt", 120_000)]

  assert.deepEqual(
    mergeExternalHistory(persisted, cached).map((item) => item.info.id),
    ["persisted-1"]
  )
})

test("preserves legitimate repeated prompts by matching semantic occurrences one-for-one", () => {
  const persisted = [message("persisted-1", "repeat me", 1_000)]
  const cached = [
    message("replayed-1", "repeat me", 120_000),
    message("actual-repeat", "repeat me", 180_000)
  ]

  assert.deepEqual(
    mergeExternalHistory(persisted, cached).map((item) => item.info.id),
    ["persisted-1", "actual-repeat"]
  )
})

test("semantic matching ignores transient part ids but keeps meaningful part differences", () => {
  const persisted = [message("persisted-1", "same prompt", 1_000)]
  const replayed = message("replayed-1", "same prompt", 120_000)
  replayed.parts[0].id = "different-part-id"
  replayed.parts[0].messageID = "different-message-id"

  assert.equal(mergeExternalHistory(persisted, [replayed]).length, 1)

  const distinct = message("distinct", "same prompt", 180_000, { type: "reasoning" })
  assert.equal(mergeExternalHistory(persisted, [distinct]).length, 2)
})

test("mergeReplay preserves common prefix and appends new messages efficiently", () => {
  const prev = [message("m1", "first", 100), message("m2", "second", 200)]
  const replayed = [message("m1", "first", 100), message("m2", "second", 200), message("m3", "third", 300)]
  const merged = mergeReplay(prev, replayed)
  assert.deepEqual(merged.map((m) => m.info.id), ["m1", "m2", "m3"])
})

test("mergeReplay handles middle modifications and suffix matches", () => {
  const prev = [message("m1", "head", 100), message("m2", "old mid", 200), message("m3", "tail", 300)]
  const replayed = [message("m1", "head", 100), message("m2-new", "new mid", 250), message("m3", "tail", 300)]
  const merged = mergeReplay(prev, replayed)
  assert.deepEqual(merged.map((m) => m.info.id), ["m1", "m2", "m2-new", "m3"])
})

test("mergeExternalHistory handles in-place mutated messages without stale signature leaks", () => {
  const msg = message("live-1", "initial text", 1_000)
  // First merge
  const first = mergeExternalHistory([msg], [msg])
  assert.equal(first.length, 1)

  // Mutate in place as streaming does
  msg.parts[0].text = "mutated streaming text"
  const distinctMsg = message("live-2", "initial text", 2_000)

  // Second merge with mutated message must recognize content difference
  const second = mergeExternalHistory([msg], [distinctMsg])
  assert.equal(second.length, 2)
})

test("differential test: mergeReplay matches full-matrix LCS on random sequences", () => {
  function referenceMergeReplay(previous, replayed) {
    if (previous.length === 0) return replayed
    if (replayed.length === 0) return previous
    // Mirrors production messageSignature: visible text only plus the failure reason. The random
    // generator below only produces user-role messages because mergeReplay additionally heals
    // consecutive identical assistant envelopes, which a raw-LCS reference would not expect.
    const messageSignature = (m) => `${m?.info?.role ?? ""}\u0000${(m?.parts ?? [])
      .filter((p) => p?.type === "text")
      .map((p) => p?.text ?? "")
      .join("")}${m?.info?.error?.message ? `\u0000${m.info.error.message}` : ""}`
    const left = previous.map(messageSignature)
    const right = replayed.map(messageSignature)
    const common = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
    for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
      for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
        common[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
          ? common[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(common[leftIndex + 1][rightIndex], common[leftIndex][rightIndex + 1])
      }
    }
    const merged = []
    let leftIndex = 0
    let rightIndex = 0
    while (leftIndex < left.length && rightIndex < right.length) {
      if (left[leftIndex] === right[rightIndex]) {
        merged.push(previous[leftIndex])
        leftIndex += 1
        rightIndex += 1
      } else if (common[leftIndex + 1][rightIndex] >= common[leftIndex][rightIndex + 1]) {
        merged.push(previous[leftIndex])
        leftIndex += 1
      } else {
        merged.push(replayed[rightIndex])
        rightIndex += 1
      }
    }
    return [...merged, ...previous.slice(leftIndex), ...replayed.slice(rightIndex)]
  }

  const alphabet = ["A", "B", "C", "D", "E", "F", "G"]
  let seed = 42
  function random() {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  for (let trial = 0; trial < 1000; trial += 1) {
    const prevLen = Math.floor(random() * 20)
    const repLen = Math.floor(random() * 20)
    const prev = Array.from({ length: prevLen }, (_, i) =>
      message(`p-${i}`, alphabet[Math.floor(random() * alphabet.length)], 100 + i)
    )
    const replayed = Array.from({ length: repLen }, (_, i) =>
      message(`r-${i}`, alphabet[Math.floor(random() * alphabet.length)], 200 + i)
    )

    const expected = referenceMergeReplay(prev, replayed).map((m) => m.info.id)
    const actual = mergeReplay(prev, replayed).map((m) => m.info.id)
    assert.deepEqual(actual, expected, `Trial ${trial} failed`)
  }
})

function envelope(id, role, parts, error) {
  return {
    info: { id, role, sessionID: "session-1", time: { created: 1_000 }, ...(error ? { error } : {}) },
    parts
  }
}
const textPart = (id, text) => ({ id, type: "text", text })
const reasoningPart = (id, text) => ({ id, type: "reasoning", text })

test("mergeReplay keeps a single copy when the live reply carried reasoning the replay omits", () => {
  // A turn prompted from the app streams agent_thought_chunk before the answer, while the
  // persisted history replays text only. The two representations are one logical message.
  const previous = [
    envelope("u2", "user", [textPart("p1", "Second question")]),
    envelope("live-a2", "assistant", [reasoningPart("p2", "Checking the transcript."), textPart("p3", "Bridge reply")])
  ]
  const replayed = [
    envelope("r-u2", "user", [textPart("p1", "Second question")]),
    envelope("r-a2", "assistant", [textPart("p3", "Bridge reply")])
  ]

  const merged = mergeReplay(previous, replayed)

  assert.deepEqual(merged.map((m) => m.info.id), ["u2", "live-a2"])
  assert.ok(
    merged[1].parts.some((part) => part.type === "reasoning"),
    "the streamed thought must survive the reconciliation"
  )
})

test("mergeReplay treats journal-split text parts and glued replay text as the same message", () => {
  // Journal loaders map each content item to its own part while replay accumulates chunks into
  // one; the signature must stay boundary-insensitive or reopening duplicates the reply.
  const previous = [
    envelope("u1", "user", [textPart("p1", "Question")]),
    envelope("jr-a1", "assistant", [textPart("p2a", "Paragraph one."), textPart("p2b", " Paragraph two.")])
  ]
  const replayed = [
    envelope("r-u1", "user", [textPart("p1", "Question")]),
    envelope("r-a1", "assistant", [textPart("p2", "Paragraph one. Paragraph two.")])
  ]

  const merged = mergeReplay(previous, replayed)

  assert.deepEqual(merged.map((m) => m.info.id), ["u1", "jr-a1"])
  assert.equal(merged[1].parts.length, 2, "the persisted part split must be preserved as-is")
})

test("mergeReplay keeps a failed turn distinct from an otherwise identical successful reply", () => {
  const failed = envelope("failed", "assistant", [textPart("p1", "Working on it.")], {
    name: "HarnessTurnError",
    message: "rate limited"
  })
  const plain = envelope("plain", "assistant", [textPart("p1", "Working on it.")])

  const merged = mergeReplay([failed], [plain])

  assert.equal(merged.length, 2)
  assert.equal(merged[0].info.error.message, "rate limited")
})

test("mergeReplay heals a poisoned history that already contains the trailing duplicate", () => {
  const poisoned = [
    envelope("u1", "user", [textPart("p1", "Question")]),
    envelope("live-a1", "assistant", [reasoningPart("p2", "thinking"), textPart("p3", "Answer")]),
    envelope("ghost-a1", "assistant", [textPart("p4", "Answer")])
  ]
  const clean = [
    envelope("r-u1", "user", [textPart("p1", "Question")]),
    envelope("r-a1", "assistant", [textPart("p3", "Answer")])
  ]

  const merged = mergeReplay(poisoned, clean)

  assert.deepEqual(merged.map((m) => m.info.id), ["u1", "live-a1"])
})

test("mergeReplay preserves legitimate repeated replies separated by prompts", () => {
  const conversation = [
    envelope("u1", "user", [textPart("p1", "Q1")]),
    envelope("a1", "assistant", [textPart("p2", "Yes")]),
    envelope("u2", "user", [textPart("p3", "Again")]),
    envelope("a2", "assistant", [textPart("p4", "Yes")])
  ]
  const replayed = [
    envelope("r-u1", "user", [textPart("p1", "Q1")]),
    envelope("r-a1", "assistant", [textPart("p2", "Yes")]),
    envelope("r-u2", "user", [textPart("p3", "Again")]),
    envelope("r-a2", "assistant", [textPart("p4", "Yes")])
  ]

  const merged = mergeReplay(conversation, replayed)

  assert.deepEqual(merged.map((m) => m.info.id), ["u1", "a1", "u2", "a2"])
})
