import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  assistantTerminalTextForPrompt,
  latestAssistantTerminalText,
  terminalMessageText
} from "./message-content.ts"

function message(id, role, parts) {
  return {
    info: { id, role, sessionID: "session-1", time: { created: 1 } },
    parts: parts.map((part, index) => ({ id: `${id}:${index}`, ...part }))
  }
}

const claudeStyleReply = message("assistant-1", "assistant", [
  { type: "text", text: "I will inspect the UI first." },
  { type: "reasoning", text: "Need to find the relevant component." },
  { type: "tool", tool: "Read", state: { status: "completed" } },
  { type: "text", text: "Fixed the UI glitch and opened PR #276." }
])

test("terminal result keeps only text after the last reasoning/tool activity", () => {
  assert.equal(terminalMessageText(claudeStyleReply), "Fixed the UI glitch and opened PR #276.")
})

test("latest terminal result never crosses the latest user turn", () => {
  const transcript = [
    message("user-1", "user", [{ type: "text", text: "First task" }]),
    claudeStyleReply,
    message("user-2", "user", [{ type: "text", text: "Second task" }]),
    message("assistant-2", "assistant", [
      { type: "text", text: "Working on it." },
      { type: "tool", tool: "Edit", state: { status: "completed" } }
    ])
  ]
  assert.equal(latestAssistantTerminalText(transcript), "")
})

test("Task summary stays attached to its Run prompt after the Session is continued manually", () => {
  const transcript = [
    message("task-user", "user", [{ type: "text", text: "Fix the TaskDesk UI" }]),
    claudeStyleReply,
    message("manual-user", "user", [{ type: "text", text: "Now refactor something else" }]),
    message("manual-assistant", "assistant", [{ type: "text", text: "The unrelated refactor is complete." }])
  ]

  assert.equal(
    assistantTerminalTextForPrompt(transcript, "Fix the TaskDesk UI"),
    "Fixed the UI glitch and opened PR #276."
  )
})

test("TaskDesk renderer preserves native part order instead of regrouping text and tools", () => {
  const renderer = readFileSync(new URL("./components/taskdesk-message-content.tsx", import.meta.url), "utf8")
  assert.match(renderer, /message\.parts\.map\(\(part\) => \{/)
  assert.match(renderer, /part\.type === "text"/)
  assert.match(renderer, /part\.type === "reasoning"/)
  assert.match(renderer, /part\.type === "tool"/)
})
