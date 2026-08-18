import assert from 'node:assert/strict'
import { createCatalogRequestGuard } from './catalog-request-guard.ts'

const context = (overrides = {}) => ({
  profileID: 'profile-1',
  configKey: 'opencode@localhost:4097',
  sessionID: 'session-1',
  directory: '/repo/a',
  ...overrides
})

// Latest request wins even when an older request resolves later.
{
  const guard = createCatalogRequestGuard()
  const first = guard.begin(context())
  const second = guard.begin(context())
  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
}

// Switching session invalidates the old destination.
{
  const guard = createCatalogRequestGuard()
  const oldSession = guard.begin(context({ sessionID: 'session-1' }))
  const newSession = guard.begin(context({ sessionID: 'session-2' }))
  assert.equal(guard.isCurrent(oldSession), false)
  assert.equal(guard.isCurrent(newSession), true)
}

// Directory is part of catalog identity: TaskDesk can create/open sessions in different worktrees.
{
  const guard = createCatalogRequestGuard()
  const oldDirectory = guard.begin(context({ directory: '/repo/a' }))
  const newDirectory = guard.begin(context({ directory: '/repo/b' }))
  assert.equal(guard.isCurrent(oldDirectory), false)
  assert.equal(guard.isCurrent(newDirectory), true)
}

// Profile/backend switches must not let the previous server populate the new picker.
{
  const guard = createCatalogRequestGuard()
  const oldServer = guard.begin(context())
  const newServer = guard.begin(context({ profileID: 'profile-2', configKey: 'codex@localhost:4098' }))
  assert.equal(guard.isCurrent(oldServer), false)
  assert.equal(guard.isCurrent(newServer), true)
}

// Manual selection or teardown can make every in-flight request stale immediately.
{
  const guard = createCatalogRequestGuard()
  const token = guard.begin(context())
  const before = guard.generation()
  guard.invalidate()
  assert.equal(guard.isCurrent(token), false)
  assert.equal(guard.generation(), before + 1)
}

// Returned tokens own copied context, so caller mutation cannot rewrite the guard's identity.
{
  const guard = createCatalogRequestGuard()
  const source = context()
  const token = guard.begin(source)
  source.sessionID = 'mutated-by-caller'
  assert.equal(token.context.sessionID, 'session-1')
  assert.equal(guard.isCurrent(token), true)
}

console.log('catalog request guard tests passed')
