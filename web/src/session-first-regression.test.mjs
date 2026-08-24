import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const discovery = readFileSync(new URL('./native-session-discovery.ts', import.meta.url), 'utf8')
const feed = readFileSync(new URL('./native-session-feed.ts', import.meta.url), 'utf8')
const observer = readFileSync(new URL('./components/native-session-observer.tsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

assert.ok(discovery.includes('listGlobalSessions(config).catch(() => client.listSessions(config))'), 'native discovery must retain global-list fallback')
assert.ok(discovery.includes('listStatuses(config).catch'), 'status enrichment must remain non-fatal')
assert.ok(discovery.includes('agentId: record.agentId'), 'native Session targets must stay scoped to their owning harness')
assert.equal(discovery.includes('createTask('), false, 'discovery must not synthesize a Task/Conversation')
assert.equal(discovery.includes('launch('), false, 'discovery must not acquire a Session writer')

assert.ok(feed.includes('mergeLatestMessagePage'), 'native Session tail refresh must reuse HR3 message identity merging')
assert.ok(feed.includes('prependOlderMessagePage'), 'native Session history paging must reuse HR3 older-page merging')

assert.ok(observer.includes('import { TaskDeskConversation } from "./taskdesk-conversation"'), 'native Session observation must reuse the HR3 chat surface')
assert.ok(observer.includes('<TaskDeskConversation'), 'native Session observer must render the existing HR3 chat')
assert.equal(observer.includes('TaskDeskMessageContent'), false, 'native Session observer must not create a second message renderer')
assert.equal(observer.includes('sendPrompt('), false, 'observation must remain read-only until resume capability is explicit')
assert.equal(observer.includes('createTask('), false, 'observation must not synthesize a Task/Conversation')
assert.equal(observer.includes('launch('), false, 'observation must not acquire a writer as a side effect')

assert.ok(main.includes('<StandaloneUniversalWorkspace'), 'the validated HR3 default workspace must remain the product entrypoint during the read-path slice')
assert.equal(main.includes('NativeSessionObserver'), false, 'the first Session-first slice must not silently replace the default HR3 shell')

console.log('session-first regression guards passed')
