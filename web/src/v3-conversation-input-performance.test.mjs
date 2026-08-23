import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")

test("the conversation signature is not recomputed on every keystroke", () => {
  // `taskConversationSignature` JSON.stringifies every Run. Rendered unconditionally it ran once per
  // character typed in the composer, which is exactly the long-conversation typing lag it caused.
  assert.match(conversation, /const conversationSignature = useMemo\(\(\) => taskConversationSignature\(task\), \[task\]\)/)
  assert.doesNotMatch(conversation, /^\s*const conversationSignature = taskConversationSignature\(task\)\s*$/m)
})

test("the composer draft is persisted on a debounce, not on every keystroke", () => {
  assert.match(conversation, /const DRAFT_PERSIST_DEBOUNCE_MS = \d+/)
  assert.match(conversation, /window\.setTimeout\(\(\) => persistDraft\(draftStorageKey, draftRef\.current\), DRAFT_PERSIST_DEBOUNCE_MS\)/)
  // Leaving the conversation must still flush whatever the debounce has not written yet.
  assert.match(conversation, /useEffect\(\(\) => \(\) => persistDraft\(draftStorageKey, draftRef\.current\)/)
  assert.doesNotMatch(conversation, /if \(draft\) localStorage\.setItem\(draftStorageKey, draft\)/)
})

test("a private-mode storage failure cannot break typing", () => {
  const persist = conversation.match(/const persistDraft = useCallback[\s\S]*?\n  \}, \[\]\)/)?.[0] || ""
  assert.match(persist, /try \{/)
  assert.match(persist, /\} catch \{/)
})

test("the working clock only ticks while a Run is actually running", () => {
  const hook = conversation.match(/function useElapsedSeconds[\s\S]*?\n\}/)?.[0] || ""
  assert.match(hook, /if \(!running\) \{/)
  assert.match(hook, /window\.setInterval\(tick, 1_000\)/)
})
