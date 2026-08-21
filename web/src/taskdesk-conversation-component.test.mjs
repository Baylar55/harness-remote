import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const component = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")

test("shared conversation owns transcript ordering and the composer", () => {
  assert.match(component, /messages\.map\(\(message\) =>/)
  assert.match(component, /<TaskDeskMessageContent message=\{message\}/)
  assert.match(component, /value=\{draft\}/)
  assert.match(component, /onDraftChange\(event\.target\.value\)/)
  assert.match(component, /event\.key !== "Enter" \|\| event\.shiftKey/)
  assert.match(component, /void onSend\(\)/)
})

test("shared conversation owns paging and scroll preservation", () => {
  assert.match(component, /hasMore/)
  assert.match(component, /onLoadOlder/)
  assert.match(component, /previousHeight/)
  assert.match(component, /current\.scrollHeight - previousHeight/)
  assert.match(component, /NEAR_BOTTOM_PX/)
  assert.match(component, /nearBottomRef/)
})

test("shared conversation owns working state presentation", () => {
  assert.match(component, /uw-session-typing/)
  assert.match(component, /waiting/)
  assert.match(component, /sending/)
  assert.match(component, /Loading conversation/)
})
