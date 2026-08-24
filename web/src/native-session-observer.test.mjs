import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const observer = readFileSync(new URL('./components/native-session-observer.tsx', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('./native-session-v3-adapter.ts', import.meta.url), 'utf8')
const workThread = readFileSync(new URL('./components/work-thread-conversation.tsx', import.meta.url), 'utf8')

assert.ok(observer.includes('import { WorkThreadConversation } from "./work-thread-conversation"'), 'native Session must mount the mature v3 conversation controller')
assert.ok(observer.includes('<WorkThreadConversation'), 'native Session must render the v3 controller directly')
assert.ok(observer.includes('registerNativeSessionV3Adapter'), 'native identity must be translated by a thin compatibility adapter')
assert.equal(observer.includes('Continue this Session'), false, 'opening a native Session must never require a visible Continue unlock step')
assert.equal(observer.includes('probeNativeSessionContinuation'), false, 'observer must not acquire ACP writer ownership while opening a Session')
assert.equal(observer.includes('TaskDeskConversation'), false, 'observer must not mount the chat renderer directly')
assert.equal(observer.includes('loadNativeSessionFeed'), false, 'observer must not own transcript loading or paging')
assert.equal(observer.includes('refreshNativeSessionFeed'), false, 'observer must not own a parallel tail refresh')
assert.equal(observer.includes('startTaskDeskSessionLiveRefresh'), false, 'observer must not own a parallel live-event controller')
assert.equal(observer.includes('sendNativeSessionPrompt'), false, 'observer must not own a parallel send controller')
assert.equal(observer.includes('stopNativeSession'), false, 'observer must not own a parallel Stop controller')
assert.equal(observer.includes('ModelSelectionControl'), false, 'observer must not own a parallel model picker')

assert.ok(adapter.includes('api.loadMessagePage = async function patchedLoadMessagePage'), 'adapter must observe the pages requested by the v3 controller')
assert.ok(adapter.includes('!entry.initialPageCaptured || Boolean(before)'), 'initial history and explicit older paging may create compatibility Run identities')
assert.ok(adapter.includes('if (!mayDiscoverRuns) return'), 'tail replay must not manufacture duplicate Runs from changed replay ids')
assert.ok(adapter.includes(':request:${clientRequestId}'), 'new native prompts must use durable client request identity for the compatibility Run')
assert.ok(adapter.includes('probeNativeSessionContinuation(entry.target)'), 'ACP writer acquisition must be deferred to the mutation boundary')
assert.ok(adapter.includes('await ensureWriter(entry)'), 'Send and Stop must acquire writer ownership transparently when needed')
assert.ok(adapter.includes('value === "retry"') && adapter.includes('value === "waiting"'), 'retry and waiting must remain working states')
assert.equal(adapter.includes('TaskDeskConversation'), false, 'adapter must not contain rendering')
assert.equal(adapter.includes('groupConversationParts'), false, 'adapter must not contain reasoning/activity semantics')

assert.ok(workThread.includes('const sendInFlightRef = useRef(false)'), 'v3 send in-flight guard must remain authoritative')
assert.ok(workThread.includes('api.loadMessagePage'), 'v3 transcript paging must remain authoritative')
assert.ok(workThread.includes('startTaskDeskSessionLiveRefresh'), 'v3 live routing must remain authoritative')
assert.ok(workThread.includes('buildWorkThreadTimeline'), 'v3 logical timeline must remain authoritative')

console.log('native Session v3-controller tests passed')
