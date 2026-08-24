import assert from 'node:assert/strict'
import {
  loadNativeSessionFeed,
  loadOlderNativeSessionFeed,
  refreshNativeSessionFeed
} from './native-session-feed.ts'
import { sendNativeSessionPrompt } from './native-session-prompt.ts'

const target = {
  key: 'pi:s1',
  machineID: 'machine-1',
  sessionID: 's1',
  directory: '/repo',
  title: 'Session',
  agentID: 'pi',
  agentLabel: 'PI',
  backend: 'pi',
  transport: 'acp',
  config: {
    backend: 'pi',
    host: '192.168.1.72',
    port: 4099,
    username: 'harness',
    password: 'secret',
    agentId: 'pi'
  },
  external: true
}

function message(id, text, role = 'assistant', extra = {}) {
  return {
    info: {
      id,
      role,
      sessionID: 's1',
      time: { created: Number(id.replace(/\D/g, '')) || 1 },
      ...(extra.error ? { error: extra.error } : {})
    },
    parts: text === undefined ? [] : [{ id: `p-${id}`, messageID: id, type: 'text', text }]
  }
}

function turn(userID, prompt, assistantID, answer) {
  return [
    message(userID, prompt, 'user'),
    message(assistantID, answer, 'assistant')
  ]
}

const calls = []
const initialClient = {
  async loadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    calls.push({ config, sessionID, directory, before, limit, refreshHistory })
    return { messages: turn('u1', 'hello', 'a1', 'one'), before: 'cursor-1', hasMore: true }
  }
}

const initial = await loadNativeSessionFeed(target, initialClient)
assert.equal(initial.messages.length, 2)
assert.equal(initial.messages[0].info.id, 'u1')
assert.equal(initial.messages[1].info.role, 'assistant')
assert.equal(initial.messages[1].parts[0].text, 'one')
assert.equal(initial.before, 'cursor-1')
assert.equal(initial.hasMore, true)
assert.equal(calls[0].config.agentId, 'pi')
assert.equal(calls[0].sessionID, 's1')
assert.equal(calls[0].directory, '/repo')
assert.equal(calls[0].limit, 200)
assert.equal(calls[0].refreshHistory, false)

const originalUser = initial.messages[0]
const originalAssistant = initial.messages[1]
const unchangedClient = {
  async loadMessagePage() {
    return { messages: turn('u1', 'hello', 'a1', 'one'), before: 'cursor-1', hasMore: true }
  }
}
const unchanged = await refreshNativeSessionFeed(target, initial, unchangedClient)
assert.equal(unchanged, initial, 'unchanged logical tail should preserve the feed object')
assert.equal(unchanged.messages[0], originalUser, 'unchanged user identity should be preserved')
assert.equal(unchanged.messages[1], originalAssistant, 'unchanged logical assistant identity should be preserved')

const changedClient = {
  async loadMessagePage() {
    return {
      messages: [
        ...turn('u1', 'hello', 'a1', 'one updated'),
        ...turn('u2', 'next', 'a2', 'two')
      ],
      before: 'cursor-1',
      hasMore: true
    }
  }
}
const changed = await refreshNativeSessionFeed(target, initial, changedClient)
assert.notEqual(changed, initial)
assert.equal(changed.messages[0], originalUser, 'unchanged user turn should retain identity during tail refresh')
assert.equal(changed.messages.length, 4)
assert.equal(changed.messages[1].parts[0].text, 'one updated')
assert.equal(changed.messages[2].info.id, 'u2')
assert.equal(changed.messages[3].parts[0].text, 'two')

const olderClient = {
  async loadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    assert.equal(before, 'cursor-1')
    assert.equal(limit, 500)
    assert.equal(refreshHistory, false)
    return { messages: turn('u0', 'older prompt', 'a0', 'older reply'), before: undefined, hasMore: false }
  }
}
const older = await loadOlderNativeSessionFeed(target, initial, olderClient)
assert.equal(older.messages.length, 4)
assert.deepEqual(older.messages.map((item) => item.info.role), ['user', 'assistant', 'user', 'assistant'])
assert.equal(older.messages[2], originalUser, 'loading history must preserve the already-rendered tail objects')
assert.equal(older.messages[3], originalAssistant)
assert.equal(older.hasMore, false)

const noMore = await loadOlderNativeSessionFeed(target, { ...older, hasMore: false }, {
  async loadMessagePage() { throw new Error('should not be called') }
})
assert.equal(noMore.hasMore, false)

// Real ACP adapters can emit several assistant envelopes inside one native user turn: progress,
// repeated error state and tool updates. v3 rendered those as one logical assistant turn. Session-first
// must do the same rather than painting each transport envelope as another chat response.
const piReplayClient = {
  async loadMessagePage() {
    const toolPending = {
      info: { id: 'pi-a2', role: 'assistant', sessionID: 's1', time: { created: 12 } },
      parts: [{
        id: 'tool-pending', messageID: 'pi-a2', type: 'tool', tool: 'read', callID: 'call-1',
        state: { status: 'running', input: { path: 'x.ts' } }
      }]
    }
    const toolDone = {
      info: { id: 'pi-a3', role: 'assistant', sessionID: 's1', time: { created: 13 }, error: { name: 'ProviderError', message: 'latest visible failure' } },
      parts: [{
        id: 'tool-done', messageID: 'pi-a3', type: 'tool', tool: 'read', callID: 'call-1',
        state: { status: 'completed', output: 'done' }
      }, { id: 'pi-answer', messageID: 'pi-a3', type: 'text', text: 'PI FINAL ANSWER' }]
    }
    return {
      messages: [
        message('pi-u1', 'PI USER MESSAGE', 'user'),
        message('pi-a1', undefined, 'assistant', { error: { name: 'ProviderError', message: 'older failure' } }),
        toolPending,
        toolDone
      ],
      before: undefined,
      hasMore: false
    }
  }
}
const piFeed = await loadNativeSessionFeed(target, piReplayClient)
assert.equal(piFeed.messages.filter((item) => item.info.role === 'user').length, 1, 'one native PI user turn must render once')
assert.equal(piFeed.messages.filter((item) => item.info.role === 'assistant').length, 1, 'PI assistant update envelopes must become one logical reply')
const piAssistant = piFeed.messages.find((item) => item.info.role === 'assistant')
assert.equal(piAssistant.info.error.message, 'latest visible failure', 'one logical turn exposes only the latest native error')
assert.equal(piAssistant.parts.filter((part) => part.type === 'tool' && part.callID === 'call-1').length, 1, 'tool updates with one callID must occupy one visible position')
assert.equal(piAssistant.parts.find((part) => part.type === 'tool' && part.callID === 'call-1').state.status, 'completed')
assert.equal(piAssistant.parts.filter((part) => part.type === 'text' && part.text === 'PI FINAL ANSWER').length, 1)

// The Session-first draft switched claimed ACP reads to refreshHistory=true, creating a second replay
// authority. The mature v3 path never does that. Even legacy callers that pass true must stay on the
// normal message authority now.
let requestedAuthority
await loadNativeSessionFeed(target, {
  async loadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    requestedAuthority = refreshHistory
    return { messages: turn('u-authority', 'hello', 'a-authority', 'one reply'), before: undefined, hasMore: false }
  }
}, 200, true)
assert.equal(requestedAuthority, false, 'claim must not switch transcript authority away from the mature v3 message path')

let refreshAuthority
await refreshNativeSessionFeed(target, initial, {
  async loadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    refreshAuthority = refreshHistory
    return { messages: turn('u1', 'hello', 'a1', 'one'), before: 'cursor-1', hasMore: true }
  }
}, 200, true)
assert.equal(refreshAuthority, false, 'claimed ACP tail refresh must remain on the mature v3 authority')

// A cross-agent target must display inherited native history before its own Session. Polling an
// unchanged target must keep the entire feed object and inherited message identities stable, or a
// long handoff transcript would rerender while the user types into B.
const historyEntry = {
  ref: { machineID: 'machine-1', agentID: 'codex', sessionID: 'source-a', directory: '/repo' },
  title: 'Source Session',
  agentID: 'codex',
  agentLabel: 'Codex CLI',
  backend: 'codex',
  messages: [
    { ...message('source-u', 'SOURCE USER', 'user'), info: { ...message('source-u', 'SOURCE USER', 'user').info, sessionID: 'source-a' } },
    { ...message('source-a', 'SOURCE ASSISTANT', 'assistant'), info: { ...message('source-a', 'SOURCE ASSISTANT', 'assistant').info, sessionID: 'source-a' } }
  ]
}
const handoffTarget = { ...target, key: 'pi:target-b', sessionID: 'target-b', external: false, history: [historyEntry] }
const targetPage = {
  async loadMessagePage() {
    return {
      messages: [
        { ...message('b-u', 'B USER', 'user'), info: { ...message('b-u', 'B USER', 'user').info, sessionID: 'target-b' } },
        { ...message('b-a', 'B ASSISTANT', 'assistant'), info: { ...message('b-a', 'B ASSISTANT', 'assistant').info, sessionID: 'target-b' } }
      ],
      before: 'b-cursor',
      hasMore: true
    }
  }
}
const linked = await loadNativeSessionFeed(handoffTarget, targetPage)
assert.equal(linked.messages.length, 4)
assert.deepEqual(linked.messages.map((item) => item.parts[0]?.text), ['SOURCE USER', 'SOURCE ASSISTANT', 'B USER', 'B ASSISTANT'])
assert.equal(linked.messages[1].taskdesk.agentLabel, 'Codex CLI', 'inherited reply must retain its original harness metadata')
const inheritedUser = linked.messages[0]
const inheritedAssistant = linked.messages[1]
const linkedUnchanged = await refreshNativeSessionFeed(handoffTarget, linked, targetPage)
assert.equal(linkedUnchanged, linked, 'unchanged B refresh must retain the complete A -> B feed object')
assert.equal(linkedUnchanged.messages[0], inheritedUser)
assert.equal(linkedUnchanged.messages[1], inheritedAssistant)

const linkedOlder = await loadOlderNativeSessionFeed(handoffTarget, linked, {
  async loadMessagePage() {
    return {
      messages: [
        { ...message('b-old-u', 'B OLDER USER', 'user'), info: { ...message('b-old-u', 'B OLDER USER', 'user').info, sessionID: 'target-b' } },
        { ...message('b-old-a', 'B OLDER ASSISTANT', 'assistant'), info: { ...message('b-old-a', 'B OLDER ASSISTANT', 'assistant').info, sessionID: 'target-b' } }
      ],
      before: undefined,
      hasMore: false
    }
  }
})
assert.deepEqual(linkedOlder.messages.map((item) => item.parts[0]?.text), [
  'SOURCE USER', 'SOURCE ASSISTANT', 'B OLDER USER', 'B OLDER ASSISTANT', 'B USER', 'B ASSISTANT'
], 'older B paging must stay after inherited A history')
assert.equal(linkedOlder.messages[0], inheritedUser)
assert.equal(linkedOlder.messages[1], inheritedAssistant)

// The first prompt in B carries a bounded v3-style context packet on the wire, while durable pending
// state retains the user's visible text separately. After acceptance the same target must not receive
// the context packet again on its next prompt.
const storage = new Map()
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null },
  setItem(key, value) { storage.set(key, String(value)) },
  removeItem(key) { storage.delete(key) }
}
const sentBodies = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (_url, options) => {
  sentBodies.push(JSON.parse(options.body))
  return { ok: true, status: 200, async text() { return JSON.stringify({ status: 'accepted' }) } }
}
try {
  const first = await sendNativeSessionPrompt(handoffTarget, 'CONTINUE THE WORK', null)
  assert.equal(first.status, 'accepted')
  assert.equal(sentBodies.length, 1)
  assert.ok(sentBodies[0].text.startsWith('You are taking over an existing TaskDesk task.'))
  assert.ok(sentBodies[0].text.includes('SOURCE ASSISTANT'))
  assert.ok(sentBodies[0].text.includes('USER INSTRUCTION\nCONTINUE THE WORK'))

  await sendNativeSessionPrompt(handoffTarget, 'SECOND TARGET PROMPT', null)
  assert.equal(sentBodies.length, 2)
  assert.equal(sentBodies[1].text, 'SECOND TARGET PROMPT', 'handoff context must be transferred only on B first accepted prompt')
} finally {
  globalThis.fetch = originalFetch
}

console.log('native session feed tests passed')
