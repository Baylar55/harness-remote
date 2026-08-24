import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const discovery = readFileSync(new URL('./native-session-discovery.ts', import.meta.url), 'utf8')
const feed = readFileSync(new URL('./native-session-feed.ts', import.meta.url), 'utf8')
const continuation = readFileSync(new URL('./native-session-continuation.ts', import.meta.url), 'utf8')
const observer = readFileSync(new URL('./components/native-session-observer.tsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

assert.ok(discovery.includes('listGlobalSessions(config).catch(() => client.listSessions(config))'), 'native discovery must retain global-list fallback')
assert.ok(discovery.includes('listStatuses(config).catch'), 'status enrichment must remain non-fatal')
assert.ok(discovery.includes('agentId: record.agentId'), 'native Session targets must stay scoped to their owning harness')
assert.equal(discovery.includes('createTask('), false, 'discovery must not synthesize a Task/Conversation')
assert.equal(discovery.includes('launch('), false, 'discovery must not acquire a Session writer')

assert.ok(feed.includes('mergeLatestMessagePage'), 'native Session tail refresh must reuse HR3 message identity merging')
assert.ok(feed.includes('prependOlderMessagePage'), 'native Session history paging must reuse HR3 older-page merging')

assert.ok(continuation.includes('listModels(target.config, target.directory, target.sessionID)'), 'ACP continuation must probe the exact native Session through the existing session/load path')
assert.ok(continuation.includes('target.backend === "opencode"'), 'OpenCode must retain its direct same-Session continuation path')
assert.equal(continuation.includes('createSession('), false, 'continuation probing must never create a replacement Session')
assert.equal(continuation.includes('createTask('), false, 'continuation probing must not synthesize a Task/Conversation')
assert.equal(continuation.includes('launch('), false, 'continuation probing must not enter the Task launcher')

assert.ok(observer.includes('import { TaskDeskConversation } from "./taskdesk-conversation"'), 'native Session continuation must reuse the HR3 chat surface')
assert.ok(observer.includes('<TaskDeskConversation'), 'native Session controller must render the existing HR3 chat')
assert.equal(observer.includes('TaskDeskMessageContent'), false, 'native Session controller must not create a second message renderer')
assert.ok(observer.includes('probeNativeSessionContinuation(target)'), 'external Sessions must remain observe-only until the safe continuation probe succeeds')
assert.ok(observer.includes('api.sendPrompt(target.config, target.sessionID, text, target.directory)'), 'continuation must send to the exact same native Session id')
assert.equal(observer.includes('createSession('), false, 'same-Session continuation must never create a replacement Session')
assert.equal(observer.includes('createTask('), false, 'same-Session continuation must not synthesize a Task/Conversation')
assert.equal(observer.includes('launch('), false, 'same-Session continuation must not use the Task launcher')

assert.ok(main.includes('<StandaloneUniversalWorkspace'), 'the validated HR3 default workspace must remain the product entrypoint during the Session-first preview slice')
assert.equal(main.includes('NativeSessionObserver'), false, 'the Session-first preview must not silently replace the default HR3 shell')

console.log('session-first regression guards passed')
