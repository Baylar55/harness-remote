import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { streamURL } from './opencode-events.ts'
import { baseUrl, isMixedContentBlocked, isValidServerConfig } from './serverConfig.ts'

const config = (host, port = 4096) => ({ backend: 'opencode', host, port, username: 'opencode', password: 'secret' })

// Regression: typing `http://192.168.1.64` passes through `http:` and `http://`, both of
// which produced an unparseable base URL. streamURL threw inside a render effect, React
// unmounted the tree, and the already-persisted host reproduced the blank screen on every
// launch until the app data was cleared.
const partialHosts = ['http:', 'http://', 'https:', 'https://', '', '   ']
for (const host of partialHosts) {
  assert.equal(isValidServerConfig(config(host)), false, `half-typed host ${JSON.stringify(host)} must be rejected`)
}

for (const host of ['Giulio-S7', 'localhost', '192.168.1.64', 'http://192.168.1.64', 'https://example.com', 'http://192']) {
  assert.equal(isValidServerConfig(config(host)), true, `usable host ${JSON.stringify(host)} must be accepted`)
}

assert.equal(isValidServerConfig(config('localhost', 0)), false, 'port 0 must be rejected')
assert.equal(isValidServerConfig(config('localhost', 70000)), false, 'out-of-range port must be rejected')
assert.equal(isValidServerConfig(config('localhost', Number.NaN)), false, 'a cleared port field must be rejected')

assert.equal(baseUrl(config('192.168.1.64')), 'http://192.168.1.64:4096', 'a bare host defaults to http')
assert.equal(baseUrl(config('https://example.com')), 'https://example.com:4096', 'an explicit scheme is preserved')

// Every accepted configuration must survive the URL building that previously crashed.
for (const host of ['Giulio-S7', 'http://192.168.1.64', 'https://example.com']) {
  assert.doesNotThrow(() => streamURL(baseUrl(config(host)), 'global'), `streamURL must not throw for ${host}`)
}

// Measured in a browser on an https page against one server bound to 0.0.0.0:4096: loopback
// answered 200, the same server on 192.168.1.64 was refused. So the installed PWA reaches a
// server on the same machine and nothing else, and the settings panel must say so — a blocked
// request surfaces only as "Failed to fetch".
for (const host of ['localhost', '127.0.0.1', '127.1.2.3', 'dev.localhost', '[::1]']) {
  assert.equal(isMixedContentBlocked(config(host), 'https:'), false, `loopback host ${host} stays reachable from https`)
}
for (const host of ['192.168.1.64', 'Giulio-S7', 'http://192.168.1.64', 'http://example.com']) {
  assert.equal(isMixedContentBlocked(config(host), 'https:'), true, `plain-http host ${host} is blocked from https`)
}
assert.equal(isMixedContentBlocked(config('https://example.com'), 'https:'), false, 'an https server is never mixed content')
// The dev server and the Capacitor build are not https pages, so the warning must stay quiet there.
for (const protocol of ['http:', 'capacitor:', 'file:']) {
  assert.equal(isMixedContentBlocked(config('192.168.1.64'), protocol), false, `no warning on a ${protocol} page`)
}
assert.equal(isMixedContentBlocked(config('http://'), 'https:'), false, 'a half-typed host must not throw or warn')

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
assert.match(
  app,
  /isMixedContentBlocked\(draftConfig, window\.location\.protocol\)/,
  'the settings panel must warn when the configured server cannot be reached from an https page'
)
assert.match(
  app,
  /!Capacitor\.isNativePlatform\(\)\s*\n?\s*&& isMixedContentBlocked/,
  'the native build reaches the server through CapacitorHttp, so it must never show that warning'
)
assert.match(
  app,
  /if \(draftConfig\.host\.trim\(\) && !isValidServerConfig\(draftConfig\)\) return/,
  'automatic saving must refuse a half-typed configuration instead of persisting a crash'
)
assert.equal(
  app.includes('if (!config.host || config.port <= 0)'),
  false,
  'connection guards must use the shared validity check, not a truthiness test'
)
assert.match(app, /const hasConfiguredServer = isValidServerConfig\(config\)/, 'navigation must gate on a usable configuration')

const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
assert.match(main, /<ErrorBoundary resetKeys=\{SERVER_STORAGE_KEYS\}>/, 'a crash must render recoverable UI instead of an empty root')

const boundary = readFileSync(new URL('./ErrorBoundary.tsx', import.meta.url), 'utf8')
assert.match(boundary, /localStorage\.removeItem\(key\)/, 'recovery must clear the saved server configuration')

console.log('server config regression tests passed')
