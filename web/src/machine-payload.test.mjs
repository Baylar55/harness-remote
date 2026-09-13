import assert from 'node:assert/strict'
import { discoverMachine } from './machineClient.ts'
import {
  DEFAULT_MACHINE_DAEMON_PORT,
  isProjectListing,
  machineCandidates,
  parseMachineSnapshot,
  selectableMachineAgents,
  unwrapPayload
} from './machinePayload.ts'

assert.deepEqual(unwrapPayload({ projects: [] }), { projects: [] })
assert.deepEqual(unwrapPayload('{"projects":[]}'), { projects: [] })
assert.deepEqual(unwrapPayload('\uFEFF{"projects":[]}'), { projects: [] })
assert.deepEqual(unwrapPayload({ data: '{"projects":[]}' }), { projects: [] })
assert.deepEqual(unwrapPayload({ data: { data: { projects: [] } } }), { projects: [] })
assert.equal(unwrapPayload('<html>not json</html>'), '<html>not json</html>')

const snapshot = { machine: { id: 'machine-1', name: 'workstation' }, agents: [] }
assert.deepEqual(parseMachineSnapshot(snapshot), snapshot)
assert.deepEqual(parseMachineSnapshot(JSON.stringify(snapshot)), snapshot)
assert.equal(parseMachineSnapshot({ sessions: [] }), null)
assert.equal(parseMachineSnapshot({ machine: { name: 'no id' }, agents: [] }), null)
assert.equal(parseMachineSnapshot({ machine: { id: 'machine-1' } }), null)

assert.equal(isProjectListing({ projects: [] }), true)
assert.equal(isProjectListing('{"projects":[{"id":"a"}]}'), true)
assert.equal(isProjectListing({ sessions: [] }), false)

const opencode = { backend: 'opencode', host: '192.168.1.64', port: 4096, username: 'harness', password: 'secret' }
const candidates = machineCandidates(opencode)
assert.equal(candidates.length, 2, 'direct OpenCode also probes the TaskDesk daemon endpoint')
assert.equal(candidates[0].port, 4096)
assert.equal(candidates[1].port, DEFAULT_MACHINE_DAEMON_PORT)
assert.equal(candidates[1].agentId, 'opencode')
assert.ok(candidates.every((candidate) => candidate.host === opencode.host))
assert.equal(machineCandidates({ ...opencode, port: 4097 }).length, 1)
assert.equal(machineCandidates({ ...opencode, backend: 'codex' }).length, 1)
assert.notEqual(machineCandidates(opencode)[0], opencode)

const agents = [
  { id: 'a', state: 'available' },
  { id: 'b', state: 'configured' },
  { id: 'c', state: 'failed' },
  { id: 'd', state: 'unknown' }
]
assert.deepEqual(
  selectableMachineAgents({ machine: { id: 'm', name: 'm' }, agents }).map((agent) => agent.id),
  ['a', 'b']
)
assert.deepEqual(selectableMachineAgents({ machine: { id: 'm', name: 'm' }, agents: undefined }), [])

// Behavioral replacement for the old source-text guards: Session-first discovery must call only
// the configured Machine endpoint. The response parser also has to tolerate a native/desktop-style
// JSON string payload instead of relying on the browser having already decoded it.
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

console.log('machine payload tests passed')
