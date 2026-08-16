/**
 * Session mutation coordinator — pure, dependency-free concurrency primitive.
 *
 * Adapted from Eric Schneider / nitsuga's Harness 3 continuation, then simplified for the
 * TaskDesk stabilization line after review of the original global-lock design.
 *
 * Important integration rule: create exactly one coordinator for the lifetime of the mounted app
 * (for React, keep it in useRef). Re-creating the coordinator while async work is in flight orphans
 * its leases and defeats stale-result protection.
 *
 * Reads such as model/agent catalog loading do NOT belong here. They must use request ids plus
 * profile/config/session/directory generation checks so a concurrent mutation never suppresses a
 * catalog refresh.
 */

export const MUTATION_KINDS = [
  "fork",
  "prompt",
  "command",
  "skill",
  "history",
  "compact",
  "rename",
  "delete",
  "abort",
  "question",
  "permission",
  "inbox",
  "create"
] as const

export type MutationKind = (typeof MUTATION_KINDS)[number]
export type MutationLane = "run" | "control" | "metadata" | "create"

export interface CoordinatorContext {
  profileID: string
  configKey: string
  sessionID: string | null
}

export interface MutationLease {
  id: number
  kind: MutationKind
  lane: MutationLane
  context: CoordinatorContext
  targetSessionID: string | null
  contextGeneration: number
  /** True when the result belongs to the selected session and must be discarded after navigation. */
  contextBound: boolean
}

export interface SessionMutationCoordinator {
  getContext(): CoordinatorContext | null
  replaceContext(context: CoordinatorContext): void
  isContextCurrent(context: CoordinatorContext): boolean
  getContextGeneration(): number
  isContextGenerationCurrent(generation: number): boolean
  acquireLease(kind: MutationKind, targetSessionID?: string | null): MutationLease | null
  releaseLease(lease: MutationLease): boolean
  isLeaseCurrent(lease: MutationLease): boolean
  isLeaseResultCurrent(lease: MutationLease): boolean
  getActiveLeases(): MutationLease[]
  /**
   * Escape hatch for lifecycle teardown or explicit recovery from a request that will never settle.
   * Invalidates every outstanding result and frees all lanes. Old releases remain harmless because
   * lease ids are monotonic and reset never rewinds them.
   */
  reset(nextContext?: CoordinatorContext | null): void
}

function cloneContext(context: CoordinatorContext): CoordinatorContext {
  return { profileID: context.profileID, configKey: context.configKey, sessionID: context.sessionID }
}

function sameContext(a: CoordinatorContext, b: CoordinatorContext): boolean {
  return a.profileID === b.profileID && a.configKey === b.configKey && a.sessionID === b.sessionID
}

function sameServerContext(a: CoordinatorContext, b: CoordinatorContext): boolean {
  return a.profileID === b.profileID && a.configKey === b.configKey
}

export function mutationLane(kind: MutationKind): MutationLane {
  if (kind === "abort" || kind === "question" || kind === "permission" || kind === "inbox") return "control"
  if (kind === "rename" || kind === "delete") return "metadata"
  if (kind === "create") return "create"
  return "run"
}

function leaseKey(lane: MutationLane, targetSessionID: string | null): string {
  return `${lane}:${targetSessionID ?? "<new-session>"}`
}

export function createSessionMutationCoordinator(
  initialContext?: CoordinatorContext
): SessionMutationCoordinator {
  let context: CoordinatorContext | null = initialContext ? cloneContext(initialContext) : null
  let contextGeneration = 0
  let nextLeaseID = 1
  const activeByKey = new Map<string, MutationLease>()

  const isLeaseCurrent = (lease: MutationLease): boolean => {
    const active = activeByKey.get(leaseKey(lease.lane, lease.targetSessionID))
    return active?.id === lease.id
  }

  return {
    getContext() {
      return context ? cloneContext(context) : null
    },

    replaceContext(nextContext: CoordinatorContext) {
      context = cloneContext(nextContext)
      contextGeneration += 1
    },

    isContextCurrent(candidate: CoordinatorContext) {
      return context !== null && sameContext(candidate, context)
    },

    getContextGeneration() {
      return contextGeneration
    },

    isContextGenerationCurrent(generation: number) {
      return generation === contextGeneration
    },

    acquireLease(kind: MutationKind, targetSessionID?: string | null) {
      if (context === null) return null
      const target = targetSessionID !== undefined ? targetSessionID : context.sessionID
      if (target === null && kind !== "create") return null

      const lane = mutationLane(kind)
      const key = leaseKey(lane, target)
      if (activeByKey.has(key)) return null

      const lease: MutationLease = {
        id: nextLeaseID++,
        kind,
        lane,
        context: cloneContext(context),
        targetSessionID: target,
        contextGeneration,
        // Whether the target was passed explicitly is irrelevant: work targeting the currently
        // selected session is navigation-bound; work targeting another session may survive only a
        // session navigation, never a profile/server change.
        contextBound: target === context.sessionID
      }
      activeByKey.set(key, lease)
      return lease
    },

    releaseLease(lease: MutationLease) {
      const key = leaseKey(lease.lane, lease.targetSessionID)
      const active = activeByKey.get(key)
      if (active?.id !== lease.id) return false
      activeByKey.delete(key)
      return true
    },

    isLeaseCurrent,

    isLeaseResultCurrent(lease: MutationLease) {
      if (!isLeaseCurrent(lease) || context === null) return false
      // Every result belongs to the server/profile it started against. Targeted metadata work may
      // survive navigation to another session, but never switching profiles/backends/configs.
      if (!sameServerContext(context, lease.context)) return false
      if (!lease.contextBound) return true
      return contextGeneration === lease.contextGeneration && sameContext(context, lease.context)
    },

    getActiveLeases() {
      return [...activeByKey.values()]
    },

    reset(nextContext?: CoordinatorContext | null) {
      activeByKey.clear()
      contextGeneration += 1
      if (nextContext !== undefined) context = nextContext ? cloneContext(nextContext) : null
    }
  }
}
