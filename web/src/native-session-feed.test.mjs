import assert from 'node:assert/strict'
import {
  loadNativeSessionFeed,
  loadOlderNativeSessionFeed,
  refreshNativeSessionFeed
} from './native-session-feed.ts'

const target = {
  key: 'codex:s1',
  sessionID: 's1',
  directory: '/repo',
  title: 'Session',
  agentID: 'codex',
  agentLabel: 'Codex',
  backend: 'codex',
  config: {
    backend: 'codex',
    host: '192.168.1.72',
    port: 4099,
    username: 'harness',
    password: 'secret',
    agentId: 'codex'
  },
  external: true
}

function message(id, text) {
  return {
    info: { id, role: 'assistant', time: { created: Number(id.replace(/\D/g, '')) || 1 } },
    parts: [{ id: `p-${id}`, type: 'text', text }]
  }
}

const calls = []
const initialClient = {
  async loadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    calls.push({ config, sessionID, directory, before, limit, refreshHistory })
    return { messages: [message('m1', 'one'), message('m2', 'two')], before: 'cursor-1', hasMore: true }
  }
}

const initial = await loadNativeSessionFeed(target, initialClient)
assert.equal(initial.messages.length, 2)
assert.equal(initial.before, 'cursor-1')
assert.equal(initial.hasMore, true)
assert.equal(calls[0].config.agentId, 'codex')
assert.equal(calls[0].sessionID, 's1')
assert.equal(calls[0].directory, '/repo')
assert.equal(calls[0].limit, 200)
assert.equal(calls[0].refreshHistory, false)

const originalFirst = initial.messages[0]
const unchangedClient = {
  async loadMessagePage() {
    return { messages: [message('m1', 'one'), message('m2', 'two')], before: 'cursor-1', hasMore: true }
  }
}
const unchanged = await refreshNativeSessionFeed(target, initial, unchangedClient)
assert.equal(unchanged, initial, 'unchanged tail should preserve the feed object')
assert.equal(unchanged.messages[0], originalFirst, 'unchanged message identity should be preserved')

const changedClient = {
  async loadMessagePage() {
    return { messages: [message('m1', 'one'), message('m2', 'two updated'), message('m3', 'three')], before: 'cursor-1', hasMore: true }
  }
}
const changed = await refreshNativeSessionFeed(target, initial, changedClient)
assert.notEqual(changed, initial)
assert.equal(changed.messages[0], originalFirst, 'unchanged messages should retain identity during a tail refresh')
assert.equal(changed.messages[1].parts[0].text, 'two updated')
assert.equal(changed.messages[2].info.id, 'm3')

const olderClient = {
  async loadMessagePage(config, sessionID, directory, before, limit) {
    assert.equal(before, 'cursor-1')
    assert.equal(limit, 500)
    return { messages: [message('m0', 'zero'), message('m1', 'duplicate')], before: undefined, hasMore: false }
  }
}
const older = await loadOlderNativeSessionFeed(target, initial, olderClient)
assert.deepEqual(older.messages.map((item) => item.info.id), ['m0', 'm1', 'm2'])
assert.equal(older.messages[1], originalFirst, 'loading history must preserve the already-rendered tail objects')
assert.equal(older.hasMore, false)

const noMore = await loadOlderNativeSessionFeed(target, { ...older, hasMore: false }, {
  async loadMessagePage() { throw new Error('should not be called') }
})
assert.equal(noMore.hasMore, false)

console.log('native session feed tests passed')
