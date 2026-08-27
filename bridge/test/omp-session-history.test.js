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
    assert.deepEqual(
      (await loadHistory(sessionID)).map((message) => message.parts.at(-1)?.text),
      ["Question", "Answer"],
      "without the optional extension, the newest terminal branch stays readable"
    )

    const messages = await loadHistory(sessionID, { activeSessionLeaf: "assistant-1" })
    assert.deepEqual(messages.map((message) => [message.info.role, message.parts.map((part) => [part.type, part.text])]), [
      ["user", [["text", "Question"]]],
      ["assistant", [["reasoning", "hidden"], ["text", "Answer"]]]
    ], "the latest active branch must exclude abandoned siblings")

    const undone = await loadHistory(sessionID, { activeSessionLeaf: "user-1" })
    assert.deepEqual(undone.map((message) => message.parts[0].text), ["Question"])
    assert.deepEqual(
      (await loadHistory(sessionID, { activeSessionLeaf: "missing-leaf" })).map((message) => message.parts.at(-1)?.text),
      ["Question", "Answer"],
      "a leaf the extension published for a journal that has since been rewritten is stale, not a reason to refuse the Session"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("uses a journal's only terminal leaf when the optional OMP extension is absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-linear-history-"))
  const sessionID = "session-linear"
  const records = [
    { type: "message", id: "user-1", parentId: null, timestamp: "2026-07-26T10:00:00.000Z", message: { role: "user", content: "Question" } },
    { type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-07-26T10:00:01.000Z", message: { role: "assistant", content: "Answer" } }
  ]
  await writeFile(path.join(root, `2026-07-26_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual((await loadHistory(sessionID)).map((message) => message.parts[0].text), ["Question", "Answer"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reports the last model selected on the inferred OMP journal branch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-model-history-"))
  const sessionID = "session-model"
  const records = [
    { type: "message", id: "u1", parentId: null, timestamp: "2026-07-26T10:00:00.000Z", message: { role: "user", content: "Question" } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-07-26T10:00:01.000Z", message: { role: "assistant", provider: "anthropic", model: "claude-sonnet-4", content: "Answer" } },
    { type: "model_change", id: "model-2", parentId: "a1", timestamp: "2026-07-26T10:00:02.000Z", model: "openai-codex/gpt-5.6" }
  ]
  await writeFile(path.join(root, `2026-07-26_${sessionID}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

  try {
    const loadHistory = createOmpHistoryLoader(root)
    const page = await loadHistory.page(sessionID, { limit: 10 })
    assert.deepEqual(page.model, { providerID: "openai-codex", modelID: "gpt-5.6" })
    assert.deepEqual(page.messages.map((message) => message.parts[0].text), ["Question", "Answer"])
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
    const inferred = await loadHistory.page(sessionID, { limit: 2 })
    assert.deepEqual(inferred.messages.map((message) => message.parts[0].text), ["abandoned-u", "abandoned-a"])
    assert.equal(inferred.hasMore, true)
    const stale = await loadHistory.page(sessionID, { activeSessionLeaf: "missing-leaf", limit: 2 })
    assert.deepEqual(
      stale.messages.map((message) => message.parts[0].text),
      ["abandoned-u", "abandoned-a"],
      "a stale extension leaf falls back to the branch OMP itself would resume rather than failing the read"
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

/*
 * The parts of the journal that only appear in old or real Sessions.
 *
 * Each of these was read out of oh-my-pi 18.x rather than inferred, because guessing at them is
 * what made the previous readers report a real conversation as empty.
 */

async function writeJournal(root, sessionID, { titleSlot = true, header = { version: 3 }, entries = [] } = {}) {
  const lines = []
  if (titleSlot) {
    const slot = JSON.stringify({ type: "title", v: 1, title: "Stored", updatedAt: "2026-08-26T10:00:00.000Z", pad: "" })
    lines.push(`${slot}${" ".repeat(Math.max(0, 256 - slot.length - 1))}`)
  }
  if (header) lines.push(JSON.stringify({ type: "session", id: sessionID, timestamp: "2026-08-26T10:00:00.000Z", cwd: "/repo", ...header }))
  for (const entry of entries) lines.push(JSON.stringify(entry))
  await writeFile(path.join(root, `2026-08-26_${sessionID}.jsonl`), `${lines.join("\n")}\n`)
}

test("the fixed title slot and the session header are not branch nodes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-header-"))
  try {
    await writeJournal(root, "session-header", {
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "Question" } },
        { type: "message", id: "e2", parentId: "e1", timestamp: "2026-08-26T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }] } }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual(
      (await loadHistory("session-header")).map((message) => [message.info.role, message.parts[0].text]),
      [["user", "Question"], ["assistant", "Answer"]],
      "a Session carrying OMP 18's title slot and header must read normally"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a journal written before the entry tree existed is read linearly with stable ids", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-v1-journal-"))
  try {
    await writeJournal(root, "session-v1", {
      titleSlot: false,
      header: {},
      entries: [
        { type: "message", timestamp: "2026-01-02T10:00:01.000Z", message: { role: "user", content: "Old question" } },
        { type: "message", timestamp: "2026-01-02T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Old answer" }] } }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    const first = await loadHistory("session-v1")
    assert.deepEqual(first.map((message) => message.parts[0].text), ["Old question", "Old answer"])
    assert.deepEqual(
      (await loadHistory("session-v1")).map((message) => message.info.id),
      first.map((message) => message.info.id),
      "position-derived ids must be identical across reads of an unmigrated journal"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("tool calls and their results are rejoined into Activity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-tools-"))
  try {
    await writeJournal(root, "session-tools", {
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "Read it" } },
        {
          type: "message",
          id: "e2",
          parentId: "e1",
          timestamp: "2026-08-26T10:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "I should read the file" },
              { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
              { type: "toolCall", id: "call-2", name: "grep", arguments: { pattern: "x" } }
            ]
          }
        },
        {
          type: "message",
          id: "e3",
          parentId: "e2",
          timestamp: "2026-08-26T10:00:03.000Z",
          message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "file body" }], isError: false }
        },
        {
          type: "message",
          id: "e4",
          parentId: "e3",
          timestamp: "2026-08-26T10:00:04.000Z",
          message: { role: "toolResult", toolCallId: "call-2", toolName: "grep", content: [{ type: "text", text: "no match" }], isError: true }
        },
        { type: "message", id: "e5", parentId: "e4", timestamp: "2026-08-26T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    const messages = await loadHistory("session-tools")
    assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant", "assistant"], "a tool result is not a message of its own")
    const activity = messages[1].parts
    assert.deepEqual(activity.map((part) => part.type), ["reasoning", "tool", "tool"])
    assert.deepEqual(activity.slice(1).map((part) => [part.tool, part.state.status, part.state.output]), [
      ["read", "completed", "file body"],
      ["grep", "error", "no match"]
    ])
    assert.ok(activity[1].state.time.start && activity[1].state.time.end, "a finished call reports when it ran")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a tool call whose result never arrived is neither a success nor a failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-tool-open-"))
  try {
    await writeJournal(root, "session-open-tool", {
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "Read it" } },
        {
          type: "message",
          id: "e2",
          parentId: "e1",
          timestamp: "2026-08-26T10:00:02.000Z",
          message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] }
        }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    const messages = await loadHistory("session-open-tool")
    assert.equal(messages[1].parts[0].state.status, "incomplete", "history must never read as still Working")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the abort reasons OMP suppresses are not shown as errors, and real failures still are", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-abort-"))
  try {
    await writeJournal(root, "session-abort", {
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "One" } },
        { type: "message", id: "e2", parentId: "e1", timestamp: "2026-08-26T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Partial" }], stopReason: "aborted", errorMessage: "Interrupted by user" } },
        { type: "message", id: "e3", parentId: "e2", timestamp: "2026-08-26T10:00:03.000Z", message: { role: "user", content: "Two" } },
        { type: "message", id: "e4", parentId: "e3", timestamp: "2026-08-26T10:00:04.000Z", message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "__omp.silent_abort__" } },
        { type: "message", id: "e5", parentId: "e4", timestamp: "2026-08-26T10:00:05.000Z", message: { role: "user", content: "Three" } },
        { type: "message", id: "e6", parentId: "e5", timestamp: "2026-08-26T10:00:06.000Z", message: { role: "assistant", content: [], errorMessage: "You have exceeded your quota" } },
        { type: "message", id: "e7", parentId: "e6", timestamp: "2026-08-26T10:00:07.000Z", message: { role: "assistant", content: [{ type: "text", text: "Later" }], errorId: 0x0400_0000, errorMessage: "aborted by the user" } }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    const messages = await loadHistory("session-abort")
    assert.deepEqual(
      messages.map((message) => [message.info.role, message.info.error?.message ?? null]),
      [
        ["user", null],
        ["assistant", null],
        ["user", null],
        ["user", null],
        ["assistant", "You have exceeded your quota"],
        ["assistant", null]
      ],
      "a Stop leaves the partial answer without a banner, while a provider refusal keeps its reason"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("injected and steering user turns are not conversation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-synthetic-"))
  try {
    await writeJournal(root, "session-synthetic", {
      entries: [
        { type: "message", id: "e1", parentId: null, timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "Real question" } },
        { type: "message", id: "e2", parentId: "e1", timestamp: "2026-08-26T10:00:02.000Z", message: { role: "user", content: "Continue.", synthetic: true } },
        { type: "message", id: "e3", parentId: "e2", timestamp: "2026-08-26T10:00:03.000Z", message: { role: "user", content: "Be quicker", steering: true } },
        { type: "message", id: "e4", parentId: "e3", timestamp: "2026-08-26T10:00:04.000Z", message: { role: "developer", content: "Repository context" } },
        { type: "message", id: "e5", parentId: "e4", timestamp: "2026-08-26T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }] } }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual(
      (await loadHistory("session-synthetic")).map((message) => [message.info.role, message.parts[0].text]),
      [["user", "Real question"], ["assistant", "Answer"]],
      "only a turn the user typed may open a turn"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an externalised image payload is skipped rather than rendered as a broken thumbnail", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-blob-"))
  try {
    await writeJournal(root, "session-blob", {
      entries: [
        {
          type: "message",
          id: "e1",
          parentId: null,
          timestamp: "2026-08-26T10:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "look" }, { type: "image", mimeType: "image/webp", data: `blob:sha256:${"a".repeat(64)}` }] }
        }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual((await loadHistory("session-blob"))[0].parts.map((part) => part.type), ["text"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the model on the branch is reported without paging the transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-branch-model-"))
  try {
    await writeJournal(root, "session-branch-model", {
      entries: [
        { type: "session_init", id: "e0", parentId: null, timestamp: "2026-08-26T10:00:00.000Z", resolvedModel: "anthropic/claude-sonnet-4" },
        { type: "message", id: "e1", parentId: "e0", timestamp: "2026-08-26T10:00:01.000Z", message: { role: "user", content: "Question" } },
        { type: "model_change", id: "e2", parentId: "e1", timestamp: "2026-08-26T10:00:02.000Z", model: "openai/gpt-5.6" },
        { type: "model_change", id: "e3", parentId: "e2", timestamp: "2026-08-26T10:00:03.000Z", role: "smol", model: "openai/gpt-5-mini" }
      ]
    })
    const loadHistory = createOmpHistoryLoader(root)
    assert.deepEqual(
      await loadHistory.sessionModel("session-branch-model"),
      { providerID: "openai", modelID: "gpt-5.6" },
      "a role-scoped model change describes a different slot and must not move the picker"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
