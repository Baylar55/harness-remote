import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeNativeResponseData } from './nativeResponse.ts'

// Issue #240: an OpenCode server on Linux passed the Android connection test and then listed no
// sessions, because CapacitorHttp had handed the session array back as a string and the client
// treated that string as the typed array. The five shapes below are the ones a native engine can
// produce for the same endpoint, and each has to survive the transport as the caller expects it.

// An already-parsed object comes back identical, by reference — re-encoding it would be a needless
// copy on every native response.
const object = { machine: { id: 'machine_1' }, agents: [] }
assert.equal(normalizeNativeResponseData(object), object)

// An already-parsed array likewise: this is the shape the browser path produces for /session.
const array = [{ id: 'ses_1' }, { id: 'ses_2' }]
assert.equal(normalizeNativeResponseData(array), array)

// A stringified object is decoded, so machine discovery reads fields rather than characters.
assert.deepEqual(
  normalizeNativeResponseData('{"machine":{"id":"machine_1"},"agents":[]}'),
  { machine: { id: 'machine_1' }, agents: [] }
)

// A stringified array is decoded into a real array. This is the failure in #240: left as a string,
// `.map`/`.filter` are absent and iterating yields single characters, so the session list came out
// empty rather than erroring in a way anyone could see.
const sessions = normalizeNativeResponseData('[{"id":"ses_1"},{"id":"ses_2"}]')
assert.ok(Array.isArray(sessions), 'a stringified session array must arrive as an array')
assert.deepEqual(sessions.map((session) => session.id), ['ses_1', 'ses_2'])

// A non-JSON string is a plain-text body — usually a server error — and must reach the caller
// verbatim, because the message is the only thing it carries.
assert.equal(normalizeNativeResponseData('Unauthorized'), 'Unauthorized')
assert.equal(normalizeNativeResponseData('OpenCode is not running on this host'), 'OpenCode is not running on this host')

// Leading whitespace is not a reason to refuse to decode, and it must not be trimmed out of a body
// that is not JSON at all.
assert.deepEqual(normalizeNativeResponseData('  \n{"ok":true}\n '), { ok: true })
assert.equal(normalizeNativeResponseData('  not json  '), '  not json  ')

// A truncated or malformed payload is returned untouched rather than throwing: a transport that
// threw here would surface as an unreachable server instead of a bad response.
assert.equal(normalizeNativeResponseData('{"id":'), '{"id":')
assert.equal(normalizeNativeResponseData('[{"id":"ses_1"}'), '[{"id":"ses_1"}')

// Empty and non-string bodies pass through, including the `true` the transport substitutes for 204.
assert.equal(normalizeNativeResponseData(''), '')
assert.equal(normalizeNativeResponseData('   '), '   ')
assert.equal(normalizeNativeResponseData(true), true)
assert.equal(normalizeNativeResponseData(0), 0)
assert.equal(normalizeNativeResponseData(null), null)
assert.equal(normalizeNativeResponseData(undefined), undefined)

// A bare JSON scalar is not decoded: only object and array bodies are ambiguous between "already
// parsed" and "handed back as text", and treating `"12"` as a number would change a text body.
assert.equal(normalizeNativeResponseData('12'), '12')
assert.equal(normalizeNativeResponseData('"quoted"'), '"quoted"')

// The normalizer must stay on the native branch and stay out of the browser and desktop paths, which
// decode their own bodies — applying it twice is harmless but applying it there hides a real
// difference between the transports.
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
assert.match(
  api,
  /if \(Capacitor\.isNativePlatform\(\)\) \{[\s\S]*?normalizeNativeResponseData\(response\.data\) as T/,
  'the native branch must normalize its response body'
)
assert.equal(
  (api.match(/normalizeNativeResponseData\(/g) ?? []).length,
  1,
  'only the native branch should normalize; the browser and desktop paths decode their own bodies'
)

console.log('native response normalization tests passed')
