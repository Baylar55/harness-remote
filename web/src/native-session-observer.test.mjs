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
assert.equal(source.includes('TaskDeskMessageContent'), false, 'observer must not grow a second message renderer')
assert.equal(source.includes('createTask('), false, 'observation must not synthesize a Task/Conversation')
assert.equal(source.includes('launch('), false, 'observation must not acquire a writer as a side effect')
assert.equal(source.includes('sendPrompt('), false, 'read-only observation must not send to the native Session')

const css = readFileSync(new URL('./native-session-observer.css', import.meta.url), 'utf8')
assert.ok(css.includes('.hr-native-session-observer .uw-composer-shell'), 'observe-only mode should hide the existing composer rather than replace the chat')

console.log('native session observer tests passed')
