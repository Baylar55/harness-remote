import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createOmpHistoryLoader } from "../src/omp-session-history.js"

test("reads only the authoritative branch from an OMP session transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-history-"))
  const nested = path.join(root, "workspace")
  await mkdir(nested)
  const sessionID = "session-1"
  const records = [
    { type: "message", id: "user-1", parentId: null, timestamp: "2026-07-26T10:00:00.000Z", message: { role: "user", content: "Question" } },
    { type: "message", id: "abandoned-assistant", parentId: "user-1", timestamp: "2026-07-26T10:00:00.500Z", message: { role: "assistant", content: [{ type: "text", text: "Abandoned answer" }] } },
    { type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-07-26T10:00:01.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Answer" }] } },
    { type: "message", id: "tool-1", parentId: "assistant-1", message: { role: "toolResult", content: [{ type: "text", text: "hidden tool output" }] } }
  ]
  await writeFile(path.join(nested, `2026-07-26_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual(await loadHistory(sessionID), [], "append order must not be treated as the active branch")

    const messages = await loadHistory(sessionID, { activeSessionLeaf: "assistant-1" })
    assert.deepEqual(messages.map((message) => [message.info.role, message.parts.map((part) => [part.type, part.text])]), [
      ["user", [["text", "Question"]]],
      ["assistant", [["reasoning", "hidden"], ["text", "Answer"]]]
    ], "the latest active branch must exclude abandoned siblings")

    const undone = await loadHistory(sessionID, { activeSessionLeaf: "user-1" })
    assert.deepEqual(undone.map((message) => message.parts[0].text), ["Question"])
    await assert.rejects(
      loadHistory(sessionID, { activeSessionLeaf: "missing-leaf" }),
      /active session leaf is missing/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("pages only the authoritative OMP branch and ignores later abandoned records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-page-"))
  const sessionID = "session-page"
  const records = [
    { type: "message", id: "u0", parentId: null, timestamp: "2026-07-26T10:00:00.000Z", message: { role: "user", content: "u0" } },
    { type: "message", id: "a0", parentId: "u0", timestamp: "2026-07-26T10:00:01.000Z", message: { role: "assistant", content: "a0" } },
    { type: "message", id: "u1", parentId: "a0", timestamp: "2026-07-26T10:00:02.000Z", message: { role: "user", content: "u1" } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-07-26T10:00:03.000Z", message: { role: "assistant", content: "a1" } },
    { type: "message", id: "u2", parentId: "a1", timestamp: "2026-07-26T10:00:04.000Z", message: { role: "user", content: "u2" } },
    { type: "message", id: "a2", parentId: "u2", timestamp: "2026-07-26T10:00:05.000Z", message: { role: "assistant", content: "a2" } },
    { type: "message", id: "abandoned-u", parentId: "a0", timestamp: "2026-07-26T10:00:06.000Z", message: { role: "user", content: "abandoned-u" } },
    { type: "message", id: "abandoned-a", parentId: "abandoned-u", timestamp: "2026-07-26T10:00:07.000Z", message: { role: "assistant", content: "abandoned-a" } }
  ]
  await writeFile(path.join(root, `2026-07-26_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    const first = await loadHistory.page(sessionID, { activeSessionLeaf: "a2", limit: 2 })
    assert.deepEqual(first.messages.map((message) => message.parts[0].text), ["u2", "a2"])
    assert.equal(first.hasMore, true)
    assert.ok(first.before)

    const second = await loadHistory.page(sessionID, { activeSessionLeaf: "a2", before: first.before, limit: 2 })
    assert.deepEqual(second.messages.map((message) => message.parts[0].text), ["u1", "a1"])
    assert.equal(second.hasMore, true)

    const third = await loadHistory.page(sessionID, { activeSessionLeaf: "a2", before: second.before, limit: 2 })
    assert.deepEqual(third.messages.map((message) => message.parts[0].text), ["u0", "a0"])
    assert.equal(third.hasMore, false)
    assert.equal(third.before, null)

    const all = [...third.messages, ...second.messages, ...first.messages]
    assert.equal(new Set(all.map((message) => message.info.id)).size, 6)
    assert.ok(all.every((message) => !message.parts.some((part) => part.text?.startsWith("abandoned"))))

    const rootPage = await loadHistory.page(sessionID, { activeSessionLeaf: null, limit: 2 })
    assert.deepEqual(rootPage, { messages: [], before: null, hasMore: false })
    assert.equal(await loadHistory.page(sessionID, { limit: 2 }), undefined, "unknown OMP leaf must fall back to ACP instead of guessing")
    await assert.rejects(
      loadHistory.page(sessionID, { activeSessionLeaf: "missing-leaf", limit: 2 }),
      /active session leaf is missing/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("replays a persisted image so an attachment survives reopening the session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-image-"))
  const sessionID = "session-image"
  // OMP re-encodes what it receives and stores no filename, so the mime must come from the
  // record rather than from what the app originally uploaded.
  const data = "UklGRpwAAABXRUJQVlA4IJAAAAAQDQCd"
  const records = [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-08-08T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "what colour is this?" }, { type: "image", data, mimeType: "image/webp" }] }
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-08-08T10:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Magenta" }] }
    }
  ]
  await writeFile(path.join(root, `2026-08-08_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    const messages = await loadHistory(sessionID, { activeSessionLeaf: "assistant-1" })
    const user = messages.find((message) => message.info.role === "user")
    assert.deepEqual(user.parts.map((part) => part.type), ["text", "file"], "the image must replay beside its caption")

    const file = user.parts[1]
    assert.equal(file.mime, "image/webp", "the stored mime must be used, not the uploaded one")
    assert.equal(file.url, `data:image/webp;base64,${data}`)
    assert.equal(file.messageID, "user-1")

    const withoutData = await loadHistory(sessionID, { activeSessionLeaf: "assistant-1" })
    assert.equal(withoutData.length, 2, "replay must stay stable across calls")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("ignores an image record carrying no payload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-image-empty-"))
  const sessionID = "session-empty-image"
  const records = [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-08-08T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "look" }, { type: "image", mimeType: "image/png" }] }
    }
  ]
  await writeFile(path.join(root, `2026-08-08_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    const messages = await loadHistory(sessionID, { activeSessionLeaf: "user-1" })
    assert.deepEqual(messages[0].parts.map((part) => part.type), ["text"], "an empty image must not become a broken thumbnail")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
