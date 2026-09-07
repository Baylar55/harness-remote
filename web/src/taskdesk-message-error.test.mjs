import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./components/taskdesk-message-content.tsx", import.meta.url), "utf8")
const styles = readFileSync(new URL("./taskdesk-conversation.css", import.meta.url), "utf8")
const baseStyles = readFileSync(new URL("./conversation-base.css", import.meta.url), "utf8")

test("native provider and harness failures remain visible inside the persisted conversation", () => {
  assert.match(source, /function readableErrorValue/)
  assert.match(source, /message\.info\.error/)
  assert.match(source, /error\.data\?\.message/)
  assert.match(source, /readableErrorValue\(error\.message\)/)
  assert.match(source, /className="uw-message-turn-error" role="alert"/)
  assert.match(source, />Turn failed</)
  assert.match(styles, /\.uw-message-turn-error \{/)
  assert.match(styles, /var\(--td3-red-border\)/)
})

test("a native turn failure wins over a stale live-active bit before reload", () => {
  assert.match(source, /const reportedError = messageErrorText\(message\)/)
  assert.match(source, /const liveTurnFailed = Boolean\(reportedError\) && !hasFinalText/)
  assert.match(source, /Boolean\(\(message as TaskDeskEnvelope\)\.taskdesk\?\.active\)[\s\S]*&& !liveTurnFailed/)
  assert.match(source, /const turnError = liveAssistant \|\| hasFinalText \? "" : reportedError/)
})

test("OpenCode protocol bookkeeping never leaks into the visible chat", () => {
  assert.match(source, /INTERNAL_PROTOCOL_PARTS = new Set\(\["step-start", "step-finish", "snapshot", "patch"\]\)/)
  assert.match(source, /visibleParts = message\.parts\.filter\(\(part\) => !isInternalProtocolPart\(part\)\)/)
})

test("a terminal assistant turn with only reasoning or tools is never silently presented as complete", () => {
  assert.match(source, /interruptedWithoutFinal/)
  assert.match(source, />Response interrupted</)
  assert.match(source, /stopped before producing a final answer/)
  assert.match(source, /assistantTurnCompleted\(message\)/)
})

test("a later final answer suppresses a stale transport or intermediate turn error", () => {
  assert.match(source, /const hasFinalText = hasTerminalAssistantText\(message\.parts\)/)
  assert.match(source, /const liveTurnFailed = Boolean\(reportedError\) && !hasFinalText/)
  assert.match(source, /const turnError = liveAssistant \|\| hasFinalText \? "" : reportedError/)
})

test("Activity-to-answer rhythm and fallback protocol parts stay visually contained", () => {
  assert.match(baseStyles, /\.tdw-work-thread-conversation \.uw-activity-group \+ \.uw-message-content-group \{[\s\S]*?margin-top: 10px;/)
  assert.match(baseStyles, /\.uw-unsupported-part \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere;/)
  assert.match(baseStyles, /\.tdw-work-thread-conversation \.uw-message-turn-error \{[\s\S]*?overflow-wrap: anywhere;/)
})
