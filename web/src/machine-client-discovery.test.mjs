import assert from 'node:assert/strict'
import { discoverMachine } from './machineClient.ts'

// Behavioral replacement for the old source-text guards in machine-payload.test.mjs. Exercise the
// real discovery path under Vite so application imports resolve exactly as they do in the web app.
const originalFetch = globalThis.fetch
const discoveryCalls = []
const discoverySnapshot = {
  machine: { id: 'machine-behavior', name: 'Behavior machine' },
  agents: [{ id: 'opencode', state: 'configured' }]
}

try {
  globalThis.fetch = async (input) => {
    discoveryCalls.push(String(input))
    return {
      status: 200,
      ok: true,
      json: async () => JSON.stringify(discoverySnapshot)
    }
  }

  const discovered = await discoverMachine({
    backend: 'opencode',
    host: 'behavior-machine.invalid',
    port: 4096,
    username: 'harness',
    password: 'secret'
  })
  assert.deepEqual(discovered, discoverySnapshot, 'active machine discovery must normalize a JSON-string payload')
  assert.deepEqual(
    discoveryCalls,
    ['http://behavior-machine.invalid:4096/v1/machine'],
    'normal Session-first discovery must use only the configured Machine endpoint'
  )

  discoveryCalls.length = 0
  globalThis.fetch = async (input) => {
    discoveryCalls.push(String(input))
    return { status: 404, ok: false, json: async () => ({}) }
  }

  const missing = await discoverMachine({
    backend: 'opencode',
    host: 'legacy-open-code.invalid',
    port: 4096,
    username: 'harness',
    password: 'secret'
  })
  assert.equal(missing, null)
  assert.deepEqual(
    discoveryCalls,
    ['http://legacy-open-code.invalid:4096/v1/machine'],
    'a missing Machine endpoint must not trigger the legacy 4097 candidate probe'
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('machine client discovery behavioral tests passed')
