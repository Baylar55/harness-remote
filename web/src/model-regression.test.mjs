import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const adapter = readFileSync(new URL('./native-session-v3-adapter.ts', import.meta.url), 'utf8')
const conversation = readFileSync(new URL('./components/work-thread-conversation.tsx', import.meta.url), 'utf8')
const picker = readFileSync(new URL('./components/model-picker.tsx', import.meta.url), 'utf8')

assert.match(adapter, /reconcileNativeSessionModel/, 'the native runtime must absorb authoritative model metadata')
assert.match(adapter, /for \(const turn of entry\.turns\.values\(\)\)/, 'recovered models must fill turns that never recorded one')
assert.match(conversation, /taskClient\.listAgentModels/, 'the active Session controller must use the daemon model catalog')
assert.match(conversation, /const scope = routing \? NATIVE_ROUTE_MODEL_SCOPE/, 'native and routed pickers must use the current harness catalog')
assert.match(conversation, /configForAgent\(destinationConfig, destinationAgents, targetAgentID\)/, 'catalog routing must keep the selected agent and backend coherent')
assert.match(conversation, /modelSelectionTouchedRef/, 'background model recovery must not overwrite an explicit picker choice')
assert.match(conversation, /conversationHasUserPrompt/, 'native model fallback must distinguish a truly empty Session from an existing conversation')
assert.match(conversation, /mayUseCatalogDefault = !deferModelFallback \\|\\| routeChanged \\|\\| !latestHasUserPrompt/, 'empty Sessions and fresh handoffs must choose a real catalog default')
assert.doesNotMatch(conversation, /routingSignature, routeChanged, conversationHasUserPrompt/, 'first-prompt discovery must not re-read the model catalog')
assert.match(conversation, /modelCatalogReady = !modelSelectionRequired \|\| \(!modelsLoading && models\.length > 0\)/, 'models-capable Sessions must stay non-writable until the live catalog is actually loaded')
assert.match(conversation, /modelBootstrapBlocked/, 'model bootstrap must gate the composer instead of falling through to a synthetic default')
assert.match(conversation, /<ModelPicker/, 'the Session controller must render the shared model picker')
assert.match(picker, /Search model, provider, variant/, 'model catalog must remain searchable')
assert.match(picker, /Harness default/, 'an unavailable catalog must fall back honestly to the harness default')

console.log('Session-first model regression tests passed')
