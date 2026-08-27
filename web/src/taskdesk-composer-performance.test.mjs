import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("Session composer typing is isolated from the long transcript", () => {
  const controller = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const conversation = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")

  assert.match(controller, /<TaskDeskConversation[\s\S]*?draft=\{draft\}[\s\S]*?onDraftChange=\{setDraft\}/)
  assert.match(conversation, /const ConversationTranscript = memo\(function ConversationTranscript/)
  assert.match(conversation, /function transcriptPropsEqual/)
  assert.match(conversation, /previous\.messages === next\.messages/)
  const comparator = conversation.match(/function transcriptPropsEqual[\s\S]*?\n\}/)?.[0] || ""
  assert.doesNotMatch(comparator, /draft/)
  assert.match(conversation, /<ConversationTranscript[\s\S]*?messages=\{messages\}/)
  assert.match(conversation, /value=\{draft\}[\s\S]*?onChange=\{\(event\) => onDraftChange\(event\.target\.value\)\}/)
})
