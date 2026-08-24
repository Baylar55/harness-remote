import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./components/taskdesk-message-content.tsx", import.meta.url), "utf8")
const turnState = readFileSync(new URL("./conversation-turn-state.ts", import.meta.url), "utf8")
const styles = readFileSync(new URL("./taskdesk-conversation.css", import.meta.url), "utf8")

test("native provider and harness failures remain visible inside the persisted conversation", () => {
  assert.match(source, /assistantTurnAttention\(message, \{ active: liveAssistant \}\)/)
  assert.match(source, /className="uw-message-turn-error" role="alert"/)
  assert.match(source, /attention\.title/)
  assert.match(source, /attention\.message/)
  assert.match(turnState, /function readableErrorValue/)
  assert.match(turnState, /message\.info\.error/)
  assert.match(turnState, /error\.data\?\.message/)
  assert.match(turnState, /readableErrorValue\(error\.message\)/)
  assert.match(styles, /\.uw-message-turn-error \{/)
  assert.match(styles, /var\(--td3-red-border\)/)
})

test("OpenCode protocol bookkeeping never leaks into the visible chat", () => {
  assert.match(turnState, /INTERNAL_PROTOCOL_PARTS = new Set\(\["step-start", "step-finish", "snapshot", "patch"\]\)/)
  assert.match(source, /visibleParts = message\.parts\.filter\(\(part\) => !isInternalProtocolPart\(part\)\)/)
})

test("terminal assistant activity without final text keeps the existing interrupted response semantics", () => {
  assert.match(turnState, /title: "Response interrupted"/)
  assert.match(turnState, /stopped before producing a final answer/)
  assert.match(turnState, /if \(message\.info\.role !== "assistant" \|\| active\) return null/)
})

test("a later final answer suppresses stale transport or intermediate turn errors", () => {
  assert.match(turnState, /if \(hasTerminalAssistantText\(message\.parts\)\) return null/)
  assert.match(turnState, /const turnError = messageErrorText\(message\)/)
})
