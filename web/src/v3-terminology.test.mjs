import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const timeline = read("./work-thread-timeline.ts")
const conversation = read("./components/work-thread-conversation.tsx")
const workspace = read("./components/conversation-workspace.tsx")
const detail = read("./components/conversation-detail.tsx")
const standalone = read("./components/standalone-universal-workspace.tsx")

test("the synthetic timeline role is not named after the old product", () => {
  // This role is invented by the client for handoff and lifecycle lines. It never reaches a harness,
  // so renaming it carries no protocol risk — unlike the /v1/tasks routes, which stay as they are.
  assert.match(timeline, /export const CONVERSATION_EVENT_ROLE = "conversation-event"/)
  assert.doesNotMatch(timeline, /role: "taskdesk"/)
  assert.match(conversation, /message\.info\.role === CONVERSATION_EVENT_ROLE/)
})

test("no user-facing copy in the 3.0 shell says Task or TaskDesk", () => {
  // Class names and module names are a separate, deliberately deferred rename. Rendered text is not.
  const copy = [workspace, detail, standalone, conversation]
    .join("\n")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
  for (const pattern of [/>[^<]*\bTaskDesk\b/, /"[^"]*\bNew task\b/i, /placeholder="[^"]*\btask\b/i]) {
    assert.doesNotMatch(copy, pattern)
  }
})
