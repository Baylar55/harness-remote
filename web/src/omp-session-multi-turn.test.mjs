import assert from 'node:assert/strict'
import test from 'node:test'

/*
 * The browser half of an OMP conversation, over several consecutive turns.
 *
 * The failure this covers was never in one module: the bridge answered a live read from its ACP
 * stream and an idle read from OMP's journal, the two describe the same messages under different
 * ids, and the newest-page merge keeps every id it is given. The transcript therefore grew a second
 * copy of each finished turn, and the timeline - which binds a Run to a turn by walking the user
 * messages - bound the running Run to the wrong one. On screen that is a second prompt that answers
 * nowhere and a conversation stuck on "getting started" until it is reopened.
 *
 * These cases pin the contract that removes it: one identity per message, for the whole life of the
 * Session. The last case states what the alternative produces, so the rule cannot be quietly undone.
 */

globalThis.window ??= globalThis
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
}

const { mergeLatestMessagePage } = await import('./message-pages.ts')
const { buildWorkThreadTimeline } = await import('./work-thread-timeline.ts')

const SESSION = 'omp-1'
const AGENTS = { omp: { label: 'Oh My Pi', backend: 'omp' } }

function user(id, text) {
  return { info: { id, role: 'user', sessionID: SESSION, time: { created: 1 } }, parts: [{ id: `${id}:t`, messageID: id, type: 'text', text }] }
}

function assistant(id, { reasoning, tool, text }) {
  const parts = []
  if (reasoning) parts.push({ id: `${id}:r`, messageID: id, type: 'reasoning', text: reasoning })
  if (tool) parts.push({ id: `${id}:c`, messageID: id, type: 'tool', tool, callID: `${id}:call`, state: { status: 'completed' } })
  if (text) parts.push({ id: `${id}:t`, messageID: id, type: 'text', text })
  return { info: { id, role: 'assistant', sessionID: SESSION, time: { created: 2 } }, parts }
}

/** A projected native Session: one Run per accepted prompt, exactly as the v3 adapter mints them. */
function task(prompts, { status = 'completed', model = null } = {}) {
  const runs = prompts.map((prompt, index) => ({
    id: `native-session-v3:omp:${SESSION}:request:${index + 1}`,
    sequence: index + 1,
    agentId: 'omp',
    model,
    role: index === 0 ? 'implement' : 'continue',
    sessionId: SESSION,
    status: index === prompts.length - 1 ? status : 'completed',
    directory: '/repo',
    prompt,
    startedAt: new Date(1000 + index).toISOString()
  }))
  return {
    id: `native-session-v3:omp:${SESSION}`,
    machineId: 'machine',
    projectId: 'native:/repo',
    project: { name: 'repo', path: '/repo', kind: 'directory' },
    title: 'Session',
    agentId: 'omp',
    prompt: prompts[0] ?? '',
    model,
    status: status === 'running' ? 'running' : 'completed',
    workspace: { mode: 'project', path: '/repo' },
    run: runs[runs.length - 1] ?? null,
    runs,
    error: null,
    createdAt: new Date(1000).toISOString(),
    updatedAt: new Date(2000).toISOString()
  }
}

function assistantFor(timeline, task) {
  const runID = task.run?.id
  return timeline.find((message) => message.info.role === 'assistant' && message.taskdesk?.runId === runID) ?? null
}

/** The one the conversation reads to decide between "getting started" and the live Activity row. */
function hasAssistantSignal(timeline, task) {
  const message = assistantFor(timeline, task)
  return Boolean(message?.parts.some((part) => {
    if (part.type === 'tool') return true
    if (part.type === 'reasoning') return Boolean(part.text?.trim())
    return part.type === 'text' && Boolean(part.text?.trim())
  }))
}

function answerText(timeline, task) {
  return (assistantFor(timeline, task)?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

test('five consecutive OMP turns each keep their own Activity and complete answer', () => {
  let feed = []
  const prompts = []

  for (let turn = 1; turn <= 5; turn += 1) {
    prompts.push(`Prompt ${turn}`)
    // Send: the turn's prompt is on the transcript, nothing has answered it yet.
    feed = mergeLatestMessagePage(feed, [...feed, user(`u${turn}`, `Prompt ${turn}`)])
    const working = task(prompts, { status: 'running' })
    let timeline = buildWorkThreadTimeline(working, { [SESSION]: feed }, AGENTS)
    assert.equal(hasAssistantSignal(timeline, working), false, `turn ${turn} starts with nothing from the agent yet`)

    // Reasoning arrives, then the tool, then the answer in two chunks - one message throughout.
    feed = mergeLatestMessagePage(feed, [...feed.slice(0, -1), feed.at(-1), assistant(`a${turn}`, { reasoning: `Thinking ${turn}` })])
    timeline = buildWorkThreadTimeline(working, { [SESSION]: feed }, AGENTS)
    assert.equal(hasAssistantSignal(timeline, working), true, `turn ${turn} must leave "getting started" as soon as it reasons`)

    feed = mergeLatestMessagePage(feed, [assistant(`a${turn}`, { reasoning: `Thinking ${turn}`, tool: 'read' })])
    feed = mergeLatestMessagePage(feed, [assistant(`a${turn}`, { reasoning: `Thinking ${turn}`, tool: 'read', text: `Answer ${turn} ` })])
    feed = mergeLatestMessagePage(feed, [assistant(`a${turn}`, { reasoning: `Thinking ${turn}`, tool: 'read', text: `Answer ${turn} part two` })])

    const ready = task(prompts)
    timeline = buildWorkThreadTimeline(ready, { [SESSION]: feed }, AGENTS)
    assert.equal(answerText(timeline, ready), `Answer ${turn} part two`, `turn ${turn} must show its complete answer`)
    assert.ok(
      assistantFor(timeline, ready).parts.some((part) => part.type === 'tool'),
      `turn ${turn} must keep its Activity`
    )
  }

  const settled = task(prompts)
  const timeline = buildWorkThreadTimeline(settled, { [SESSION]: feed }, AGENTS)
  assert.deepEqual(
    timeline.filter((message) => message.info.role === 'user').map((message) => message.parts[0].text),
    prompts,
    'the conversation shows five prompts and no repeats'
  )
  assert.equal(feed.length, 10, 'five turns are ten messages, not twenty')
  assert.equal(new Set(feed.map((message) => message.info.id)).size, 10)
  assert.equal(
    timeline.filter((message) => message.taskdesk?.kind === 'event').length,
    0,
    'continuing in one Session announces nothing'
  )
})

test('repeated identical prompts stay separate turns with their own answers', () => {
  const feed = [
    user('u1', 'Same question'),
    assistant('a1', { text: 'First answer' }),
    user('u2', 'Same question'),
    assistant('a2', { text: 'Second answer' })
  ]
  const settled = task(['Same question', 'Same question'])
  const timeline = buildWorkThreadTimeline(settled, { [SESSION]: feed }, AGENTS)
  assert.equal(answerText(timeline, settled), 'Second answer', 'the newest Run must bind to the newest turn')
  assert.deepEqual(
    timeline.filter((message) => message.info.role === 'assistant').map((message) => message.parts.map((part) => part.text)),
    [['First answer'], ['Second answer']],
    'the earlier identical prompt keeps its own answer'
  )
})

test('a complete reply is never replaced by a shorter one that arrives afterwards', () => {
  const complete = mergeLatestMessagePage(
    [user('u1', 'Prompt 1'), assistant('a1', { text: 'Answer with its last words' })],
    [assistant('a1', { text: 'Answer with its' })]
  )
  const settled = task(['Prompt 1'])
  assert.equal(
    answerText(buildWorkThreadTimeline(settled, { [SESSION]: complete }, AGENTS), settled),
    'Answer with its last words'
  )
})

test('handing the same turn a second identity is what makes a live turn read as blank', () => {
  // Not a supported shape - it is the shape the bridge must never produce, kept here so the reason
  // the OMP read path has a single authority stays legible.
  const withDuplicate = mergeLatestMessagePage(
    [user('u1', 'Prompt 1'), assistant('a1', { text: 'Answer 1' })],
    [user('journal-u1', 'Prompt 1'), assistant('journal-a1', { text: 'Answer 1' })]
  )
  const feed = mergeLatestMessagePage(withDuplicate, [...withDuplicate, user('u2', 'Prompt 2')])
  const working = task(['Prompt 1', 'Prompt 2'], { status: 'running' })
  const timeline = buildWorkThreadTimeline(working, { [SESSION]: feed }, AGENTS)
  assert.equal(
    answerText(timeline, working),
    '',
    'a duplicated first turn leaves the second Run bound to a turn nobody answered'
  )
})
