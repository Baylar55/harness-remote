/*
 * Catalog request guard for model/agent discovery.
 *
 * Catalog loading is READ-ONLY and must never participate in the session mutation lock. Its race
 * problem is different: an older request can finish after the user has switched profile, backend,
 * session or directory and must not overwrite the picker for the new destination.
 *
 * Keep one guard instance for the lifetime of the React owner (useRef). Every request snapshots a
 * monotonically increasing id plus its destination. A result may update UI only while both are
 * still current. invalidate() is used by manual selection/context teardown to make all in-flight
 * results stale immediately.
 *
 * Adapted from the stale-response protections developed by Eric Schneider / nitsuga on the Harness
 * 3 continuation, but deliberately separated from mutation locking for TaskDesk.
 */

export interface CatalogRequestContext {
  profileID: string
  configKey: string
  sessionID: string | null
  directory: string | null
}

export interface CatalogRequestToken {
  id: number
  context: CatalogRequestContext
}

export interface CatalogRequestGuard {
  begin(context: CatalogRequestContext): CatalogRequestToken
  isCurrent(token: CatalogRequestToken): boolean
  invalidate(): void
  generation(): number
}

function copyContext(context: CatalogRequestContext): CatalogRequestContext {
  return { ...context }
}

function sameContext(left: CatalogRequestContext, right: CatalogRequestContext): boolean {
  return left.profileID === right.profileID
    && left.configKey === right.configKey
    && left.sessionID === right.sessionID
    && left.directory === right.directory
}

export function createCatalogRequestGuard(): CatalogRequestGuard {
  let nextID = 1
  let currentID = 0
  let currentContext: CatalogRequestContext | null = null
  let invalidationGeneration = 0

  return {
    begin(context) {
      const token = { id: nextID++, context: copyContext(context) }
      currentID = token.id
      currentContext = copyContext(context)
      return token
    },

    isCurrent(token) {
      return token.id === currentID
        && currentContext !== null
        && sameContext(token.context, currentContext)
    },

    invalidate() {
      currentID = 0
      currentContext = null
      invalidationGeneration += 1
    },

    generation() {
      return invalidationGeneration
    }
  }
}
