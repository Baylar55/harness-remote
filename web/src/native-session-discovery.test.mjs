import assert from 'node:assert/strict'
import {
  discoverAgentNativeSessions,
  discoverMachineNativeSessions,
  nativeSessionConfig
} from './native-session-discovery.ts'

const base = {
  backend: 'opencode',
  host: '192.168.1.72',
  port: 4099,
  username: 'harness',
  password: 'secret'
}

const codex = {
  id: 'codex',
  label: 'Codex',
  backend: 'codex',
  transport: 'acp',
  managed: true,
  state: 'available',
  capabilities: { sessions: true }
}

assert.deepEqual(nativeSessionConfig(base, codex), {
  ...base,
  backend: 'codex',
  agentId: 'codex'
})

const calls = []
const client = {
  async listGlobalSessions(config) {
    calls.push(['global', config.backend, config.agentId])
    return [{ id: 's1', title: 'Native Codex', directory: '/repo', time: { created: 1, updated: 20 }, external: true }]
  },
  async listSessions(config) {
    calls.push(['stable', config.backend, config.agentId])
    return []
  },
  async listStatuses(config) {
    calls.push(['status', config.backend, config.agentId])
    return { s1: { type: 'busy' } }
  }
}

const codexSessions = await discoverAgentNativeSessions(base, codex, client)
assert.equal(codexSessions.length, 1)
assert.equal(codexSessions[0].key, 'codex:s1')
assert.equal(codexSessions[0].agentLabel, 'Codex')
assert.equal(codexSessions[0].backend, 'codex')
assert.equal(codexSessions[0].session.external, true)
assert.equal(codexSessions[0].status.type, 'busy')
assert.deepEqual(calls, [
  ['global', 'codex', 'codex'],
  ['status', 'codex', 'codex']
])

const fallbackCalls = []
const fallbackClient = {
  async listGlobalSessions(config) {
    fallbackCalls.push(['global', config.agentId])
    throw new Error('unsupported')
  },
  async listSessions(config) {
    fallbackCalls.push(['stable', config.agentId])
    return [{ id: 'p1', title: 'PI native', directory: '/repo', time: { created: 1, updated: 10 } }]
  },
  async listStatuses(config) {
    fallbackCalls.push(['status', config.agentId])
    throw new Error('status unavailable')
  }
}

const pi = { ...codex, id: 'pi', label: 'PI', backend: 'pi' }
const fallbackSessions = await discoverAgentNativeSessions(base, pi, fallbackClient)
assert.equal(fallbackSessions.length, 1)
assert.equal(fallbackSessions[0].key, 'pi:p1')
assert.equal(fallbackSessions[0].status, undefined)
assert.deepEqual(fallbackCalls, [
  ['global', 'pi'],
  ['stable', 'pi'],
  ['status', 'pi']
])

let disabledReads = 0
const disabled = { ...codex, id: 'disabled', capabilities: { sessions: false } }
assert.deepEqual(await discoverAgentNativeSessions(base, disabled, {
  async listGlobalSessions() { disabledReads += 1; return [] },
  async listSessions() { disabledReads += 1; return [] },
  async listStatuses() { disabledReads += 1; return {} }
}), [])
assert.equal(disabledReads, 0)

const machineClient = {
  async listGlobalSessions(config) {
    if (config.agentId === 'broken') throw new Error('adapter failed')
    return [{
      id: `${config.agentId}-session`,
      title: config.agentId,
      directory: '/repo',
      time: { created: 1, updated: config.agentId === 'codex' ? 30 : 15 }
    }]
  },
  async listSessions() { return [] },
  async listStatuses() { return {} }
}

const records = await discoverMachineNativeSessions(base, [
  pi,
  codex,
  { ...codex, id: 'broken', label: 'Broken', backend: 'claude' }
], machineClient)
assert.deepEqual(records.map((record) => record.key), ['codex:codex-session', 'pi:pi-session'])

console.log('native session discovery tests passed')
