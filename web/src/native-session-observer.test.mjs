import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nativeSessionIsWorking } from './components/native-session-observer.tsx'

assert.equal(nativeSessionIsWorking('busy'), true)
assert.equal(nativeSessionIsWorking('running'), true)
assert.equal(nativeSessionIsWorking('working'), true)
assert.equal(nativeSessionIsWorking('in_progress'), true)
assert.equal(nativeSessionIsWorking('idle'), false)
assert.equal(nativeSessionIsWorking(undefined), false)

const source = readFileSync(new URL('./components/native-session-observer.tsx', import.meta.url), 'utf8')
assert.ok(source.includes('import { TaskDeskConversation } from "./taskdesk-conversation"'), 'native Session observation must reuse the HR3 chat surface')
assert.ok(source.includes('<TaskDeskConversation'), 'observer should render the existing chat component')
assert.ok(source.includes('hr-native-session-observer tdw-work-thread-conversation'), 'native Session detail must inherit the mature HR3 chat formatting scope')
assert.equal(source.includes('TaskDeskMessageContent'), false, 'observer must not grow a second message renderer')
assert.equal(source.includes('createTask('), false, 'observation must not synthesize a Task/Conversation')
assert.equal(source.includes('launch('), false, 'observation must not acquire a writer as a side effect')
assert.equal(source.includes('sendPrompt('), false, 'read-only observation must not send to the native Session')

// A claimed ACP Session must never alternate between journal ids and ACP replay/live ids. The claim
// boundary replaces the read-only journal page once, and all later refresh/paging stays on the same
// owned authority. This protects both single-render semantics and chronological ordering.
assert.ok(source.includes('writeStateRef.current === "ready" && target.transport === "acp"'), 'claimed ACP refreshes must detect owned transcript authority')
assert.ok(source.includes('loadNativeSessionFeed(target, undefined, 200, true)'), 'successful ACP claim must replace the journal page with the owned replay/cache')
assert.ok(source.includes('refreshHistory || keepOwnedAuthority'), 'claimed ACP tail refresh must not fall back to journal paging')
assert.ok(source.includes('loadOlderNativeSessionFeed(target, current, undefined, 500, keepOwnedAuthority)'), 'claimed ACP older paging must stay on one transcript authority')

const css = readFileSync(new URL('./native-session-observer.css', import.meta.url), 'utf8')
assert.ok(css.includes('.hr-native-session-observer.observe-only .uw-composer-shell'), 'observe-only mode should hide the existing composer rather than replace the chat')
assert.match(css, /\.hr-native-session-observer\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow:\s*hidden;/, 'native Session detail must be a bounded flex column')
assert.match(css, /\.hr-native-session-observer \.uw-transcript-shell\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow:\s*hidden;/, 'transcript shell must shrink inside the Session detail instead of pushing the composer away')
assert.match(css, /\.hr-native-session-observer \.uw-transcript\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow-y:\s*auto;/, 'the reused HR3 transcript must remain the vertical scroll owner')
assert.match(css, /\.hr-native-session-continuation\s*\{[\s\S]*?flex:\s*0 0 auto;/, 'Continue banner must not consume the transcript scroll region')

console.log('native session observer tests passed')
