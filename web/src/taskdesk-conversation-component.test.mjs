import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const component = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")
const controller = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
const observer = readFileSync(new URL("./components/native-session-observer.tsx", import.meta.url), "utf8")
const taskClient = readFileSync(new URL("./taskClient.ts", import.meta.url), "utf8")

test("shared conversation owns transcript ordering and the composer", () => {
  assert.match(component, /messages\.map\(\(message\) =>/)
  assert.match(component, /<TaskDeskMessageContent message=\{message\}/)
  assert.match(component, /value=\{draft\}/)
  assert.match(component, /onDraftChange\(event\.target\.value\)/)
  assert.match(component, /void onSend\(\)/)
})

test("native Sessions consume the shared conversation through the mature controller", () => {
  assert.match(observer, /<WorkThreadConversation/)
  assert.match(controller, /<TaskDeskConversation/)
  assert.match(controller, /messages=\{visibleTimeline\}/)
  assert.match(controller, /onLoadOlder=\{loadOlder\}/)
  assert.match(controller, /draft=\{draft\}/)
  assert.match(controller, /onSend=\{send\}/)
})

test("composer keystrokes do not walk or rerender the long transcript", () => {
  assert.match(component, /const ConversationTranscript = memo/)
  assert.match(component, /function transcriptPropsEqual/)
  assert.match(component, /previous\.messages === next\.messages/)
  assert.doesNotMatch(component.match(/function transcriptPropsEqual[\s\S]*?\n\}/)?.[0] || "", /draft/)
})

test("shared conversation owns paging and scroll preservation", () => {
  assert.match(component, /hasMore/)
  assert.match(component, /onLoadOlder/)
  assert.match(component, /previousTop/)
  assert.match(component, /Math\.min\(previousTop, current\.scrollHeight - current\.clientHeight\)/)
  assert.match(component, /NEAR_BOTTOM_PX/)
  assert.match(component, /nearBottomRef/)
})

test("conversation mutations reconcile ambiguous outcomes instead of blindly resending", () => {
  assert.match(taskClient, /clientRequestId/)
  assert.match(taskClient, /PENDING_CONTINUE_STORAGE_PREFIX/)
  assert.match(taskClient, /hasClientRequest\(latest, pending\.clientRequestId\)/)
})
