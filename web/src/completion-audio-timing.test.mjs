import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  armCompletionAudio,
  cancelCompletionAudio,
  noteAssistantActivity,
  observeCompletionStatuses,
  resetCompletionAudioForTests
} from './completion-audio.ts'

// Issue #233: the sound used to be tied to the first assistant fragment, so it played when the reply
// started rather than when the harness finished. These check the timing rules themselves rather than
// the shape of the source, so renaming a helper cannot make them pass vacuously.
//
// observeCompletionStatuses returns the sessions it completed; an empty result is "no sound".

const idle = (id) => ({ [id]: { type: 'idle' } })
const busy = (id) => ({ [id]: { type: 'busy' } })

function scenario(name, run) {
  resetCompletionAudioForTests()
  run()
  console.log(`  ok ${name}`)
}

scenario('a submitted prompt makes no sound on its own', () => {
  armCompletionAudio('ses_1')
  // The status poll that lands before the harness has picked the turn up still reads idle. Playing
  // here is the "sound at send time" the issue reported.
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), [])
})

scenario('the first assistant fragment does not play the sound', () => {
  armCompletionAudio('ses_1')
  // A working status is never terminal on its own, however many times it is observed.
  assert.deepEqual(observeCompletionStatuses(busy('ses_1')), [])
  noteAssistantActivity()
  // Output has started and the session is still working: this is exactly the moment the old
  // implementation played.
  assert.deepEqual(observeCompletionStatuses(busy('ses_1')), [])
  assert.deepEqual(observeCompletionStatuses(busy('ses_1')), [])
})

scenario('the sound plays when the session goes from working to idle', () => {
  armCompletionAudio('ses_1')
  observeCompletionStatuses(busy('ses_1'))
  noteAssistantActivity()
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), ['ses_1'])
})

scenario('the sound plays exactly once, however often the status is polled', () => {
  armCompletionAudio('ses_1')
  observeCompletionStatuses(busy('ses_1'))
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), ['ses_1'])
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), [])
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), [])
})

scenario('retry and waiting count as working, so a retried turn plays once at the end', () => {
  armCompletionAudio('ses_1')
  assert.deepEqual(observeCompletionStatuses({ ses_1: { type: 'waiting' } }), [])
  assert.deepEqual(observeCompletionStatuses({ ses_1: { type: 'retry' } }), [])
  assert.deepEqual(observeCompletionStatuses({ ses_1: { type: 'busy' } }), [])
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), ['ses_1'])
})

scenario('aborting a turn cancels the sound', () => {
  armCompletionAudio('ses_1')
  observeCompletionStatuses(busy('ses_1'))
  noteAssistantActivity()
  cancelCompletionAudio('ses_1')
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), [])
})

scenario('a submission that failed cancels the sound', () => {
  // What the transport does when the prompt request errors or answers >= 400.
  armCompletionAudio('ses_1')
  cancelCompletionAudio('ses_1')
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), [])
})

scenario('a status poll that omits the armed session decides nothing', () => {
  armCompletionAudio('ses_1')
  observeCompletionStatuses(busy('ses_1'))
  assert.deepEqual(observeCompletionStatuses({ ses_other: { type: 'idle' } }), [])
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), ['ses_1'])
})

scenario('a harness that never reports working still completes once output was seen', () => {
  armCompletionAudio('ses_1')
  noteAssistantActivity()
  assert.deepEqual(observeCompletionStatuses(idle('ses_1')), ['ses_1'])
})

scenario('two sessions complete independently', () => {
  armCompletionAudio('ses_1')
  armCompletionAudio('ses_2')
  observeCompletionStatuses({ ses_1: { type: 'busy' }, ses_2: { type: 'busy' } })
  assert.deepEqual(observeCompletionStatuses({ ses_1: { type: 'idle' }, ses_2: { type: 'busy' } }), ['ses_1'])
  assert.deepEqual(observeCompletionStatuses({ ses_1: { type: 'idle' }, ses_2: { type: 'idle' } }), ['ses_2'])
})

scenario('assistant activity is attributed to the session most likely producing it', () => {
  armCompletionAudio('ses_old')
  armCompletionAudio('ses_new')
  // Only ses_old is working, so a fragment belongs to it rather than to the more recently armed one.
  observeCompletionStatuses({ ses_old: { type: 'busy' } })
  noteAssistantActivity()
  assert.deepEqual(observeCompletionStatuses({ ses_old: { type: 'idle' } }), ['ses_old'])
  // ses_new never worked and never produced output, so its idle status still plays nothing.
  assert.deepEqual(observeCompletionStatuses({ ses_new: { type: 'idle' } }), [])
})

resetCompletionAudioForTests()

// The rules above only matter if the transports are still wired to them, and that wiring needs a
// Vite environment to install, so it stays asserted at the source level.
const source = readFileSync(new URL('./completion-audio.ts', import.meta.url), 'utf8')
assert.match(source, /if \(armedSessionID && !response\.ok\) cancelCompletionAudio\(armedSessionID\)/, 'a rejected prompt must cancel the armed sound in the browser transport')
assert.match(source, /if \(armedSessionID && response\.status >= 400\) cancelCompletionAudio\(armedSessionID\)/, 'a rejected prompt must cancel the armed sound in the native transport')
assert.match(source, /catch \(error\) \{\s*if \(armedSessionID\) cancelCompletionAudio\(armedSessionID\)/, 'a prompt that never reached the server must cancel the armed sound')
assert.match(source, /noteAssistantActivity\(\)\s*\n\s*return Promise\.resolve\(\)/, 'the premature playback request must be recorded as activity and swallowed')

console.log('completion audio timing tests passed')
