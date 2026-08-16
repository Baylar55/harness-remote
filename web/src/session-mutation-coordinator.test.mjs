import assert from 'node:assert/strict'
import {
  MUTATION_KINDS,
  createSessionMutationCoordinator,
  mutationLane
} from './session-mutation-coordinator.ts'

const ctx = (sessionID = 'session-1') => ({
  profileID: 'profile-1',
  configKey: 'backend-a',
  sessionID
})

assert.equal(MUTATION_KINDS.length, 13)
assert.equal(new Set(MUTATION_KINDS).size, MUTATION_KINDS.length)
assert.equal(MUTATION_KINDS.includes('model'), false)
assert.equal(MUTATION_KINDS.includes('agent'), false)
assert.equal(mutationLane('prompt'), 'run')
assert.equal(mutationLane('abort'), 'control')
assert.equal(mutationLane('permission'), 'control')
assert.equal(mutationLane('rename'), 'metadata')
assert.equal(mutationLane('create'), 'create')

{
  const coordinator = createSessionMutationCoordinator(ctx())
  const prompt = coordinator.acquireLease('prompt')
  assert.ok(prompt)
  assert.equal(coordinator.acquireLease('command'), null, 'run lane must serialize on the same session')

  const abort = coordinator.acquireLease('abort')
  assert.ok(abort, 'abort must remain available while a prompt is in flight')
  assert.equal(coordinator.acquireLease('permission'), null, 'control lane itself stays serialized')

  assert.equal(coordinator.getActiveLeases().length, 2)
  assert.equal(coordinator.releaseLease(abort), true)
  assert.equal(coordinator.releaseLease(prompt), true)
}

{
  const coordinator = createSessionMutationCoordinator(ctx('session-1'))
  const first = coordinator.acquireLease('rename', 'session-2')
  const second = coordinator.acquireLease('rename', 'session-3')
  assert.ok(first)
  assert.ok(second)
  assert.equal(coordinator.acquireLease('delete', 'session-2'), null, 'same target metadata lane must serialize')
  assert.equal(coordinator.releaseLease(first), true)
  assert.equal(coordinator.releaseLease(second), true)
}

{
  const coordinator = createSessionMutationCoordinator(ctx('session-1'))
  const prompt = coordinator.acquireLease('prompt')
  const rename = coordinator.acquireLease('rename', 'session-9')
  assert.ok(prompt)
  assert.ok(rename)
  assert.equal(prompt.contextBound, true)
  assert.equal(rename.contextBound, false)

  coordinator.replaceContext(ctx('session-2'))
  assert.equal(coordinator.isLeaseCurrent(prompt), true, 'navigation does not steal physical ownership')
  assert.equal(coordinator.isLeaseResultCurrent(prompt), false, 'old selected-session result must be stale')
  assert.equal(coordinator.isLeaseResultCurrent(rename), true, 'targeted rename remains legitimate after navigation')

  assert.equal(coordinator.releaseLease(prompt), true)
  assert.equal(coordinator.releaseLease(rename), true)
}

{
  const coordinator = createSessionMutationCoordinator(ctx())
  const stuck = coordinator.acquireLease('prompt')
  assert.ok(stuck)
  const beforeReset = coordinator.getContextGeneration()

  coordinator.reset()
  assert.equal(coordinator.getActiveLeases().length, 0)
  assert.equal(coordinator.getContextGeneration(), beforeReset + 1)
  assert.equal(coordinator.isLeaseCurrent(stuck), false)
  assert.equal(coordinator.isLeaseResultCurrent(stuck), false)

  const next = coordinator.acquireLease('prompt')
  assert.ok(next)
  assert.ok(next.id > stuck.id, 'reset must not rewind lease ids')
  assert.equal(coordinator.releaseLease(stuck), false, 'stale owner cannot clear newer work')
  assert.equal(coordinator.isLeaseCurrent(next), true)
  assert.equal(coordinator.releaseLease(next), true)
}

{
  const coordinator = createSessionMutationCoordinator(ctx(null))
  assert.equal(coordinator.acquireLease('prompt'), null)
  const create = coordinator.acquireLease('create')
  assert.ok(create)
  assert.equal(create.targetSessionID, null)
  assert.equal(create.lane, 'create')
  assert.equal(coordinator.releaseLease(create), true)
}

{
  const coordinator = createSessionMutationCoordinator()
  assert.equal(coordinator.acquireLease('create'), null)
  assert.equal(coordinator.acquireLease('prompt', 'session-1'), null)
}

{
  const initial = ctx('session-1')
  const coordinator = createSessionMutationCoordinator(initial)
  initial.sessionID = 'mutated-outside'
  assert.equal(coordinator.getContext().sessionID, 'session-1')

  const exposed = coordinator.getContext()
  exposed.sessionID = 'mutated-copy'
  assert.equal(coordinator.getContext().sessionID, 'session-1')

  const lease = coordinator.acquireLease('prompt')
  assert.ok(lease)
  lease.context.sessionID = 'mutated-lease-copy'
  assert.equal(coordinator.getContext().sessionID, 'session-1')
  assert.equal(coordinator.releaseLease(lease), true)
}

{
  const coordinator = createSessionMutationCoordinator(ctx('A'))
  const lease = coordinator.acquireLease('prompt')
  assert.ok(lease)
  const generation = lease.contextGeneration
  coordinator.replaceContext(ctx('B'))
  coordinator.replaceContext(ctx('A'))
  assert.equal(coordinator.isContextCurrent(lease.context), true, 'plain context equality has ABA ambiguity')
  assert.equal(coordinator.isContextGenerationCurrent(generation), false, 'generation must reject old work')
  assert.equal(coordinator.isLeaseResultCurrent(lease), false)
  assert.equal(coordinator.releaseLease(lease), true)
}

console.log('session mutation coordinator tests passed')
