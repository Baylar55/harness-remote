import type { ServerConfig, SessionStatus } from "./types.js"

/**
 * Session-index invalidations are intentionally coarser than transcript streaming. Lifecycle edges
 * can change a rail row and therefore require one fresh Session-index read; token chunks must not
 * fan out into global Session discovery.
 */
const SESSION_INDEX_LIFECYCLE_EVENTS = new Set([
  "session.status",
  "session.idle",
  "session.updated",
  "session.created",
  "session.deleted",
  "session.error",
  // OpenCode changes message metadata at turn boundaries while token chunks use part events. This
  // gives the rail one bounded second chance after the terminal message without refreshing per token.
  "message.updated"
])

// A status edge and `/session/status` are separate reads. Keep the fresher streamed status just long
// enough for the Session-index reconciliation triggered by that same edge to win a short endpoint
// lag, then fall back to the native index again. A later streamed status always supersedes it.
export const LIVE_SESSION_STATUS_GRACE_MS = 15_000
// OpenCode session.error is a lifecycle event, not guaranteed to be durable in the message endpoint
// immediately. Keep the exact provider error across ordinary Session navigation long enough for the
// durable transcript to catch up. A later busy/retry edge clears it immediately.
export const LIVE_SESSION_ERROR_GRACE_MS = 2 * 60_000

type LiveStatus = { status: SessionStatus; observedAt: number }
type LiveError = { message: string; observedAt: number }

type LiveEvent = {
  type: string
  sessionID?: string
  status?: string
  statusMessage?: string
  statusAttempt?: number
  statusNext?: number
  errorMessage?: string
}

const liveStatuses = new Map<string, Map<string, LiveStatus>>()
const liveErrors = new Map<string, Map<string, LiveError>>()
const invalidationListeners = new Set<() => void>()
let invalidationRevision = 0

function endpointKey(config: Pick<ServerConfig, "host" | "port" | "username" | "backend">): string {
  const host = config.host.trim().replace(/\/+$/, "").toLowerCase()
  return `${host}:${config.port}|${config.username.trim()}|${config.backend}`
}

function pruneLiveStatuses(key: string, now: number): void {
  const bySession = liveStatuses.get(key)
  if (!bySession) return
  for (const [sessionID, entry] of bySession) {
    if (now - entry.observedAt > LIVE_SESSION_STATUS_GRACE_MS) bySession.delete(sessionID)
  }
  if (bySession.size === 0) liveStatuses.delete(key)
}

function pruneLiveErrors(key: string, now: number): void {
  const bySession = liveErrors.get(key)
  if (!bySession) return
  for (const [sessionID, entry] of bySession) {
    if (now - entry.observedAt > LIVE_SESSION_ERROR_GRACE_MS) bySession.delete(sessionID)
  }
  if (bySession.size === 0) liveErrors.delete(key)
}

function deleteSessionState(key: string, sessionID: string): void {
  liveStatuses.get(key)?.delete(sessionID)
  if (liveStatuses.get(key)?.size === 0) liveStatuses.delete(key)
  liveErrors.get(key)?.delete(sessionID)
  if (liveErrors.get(key)?.size === 0) liveErrors.delete(key)
}

function invalidateSessionIndex(): void {
  invalidationRevision += 1
  for (const listener of invalidationListeners) listener()
}

export function sessionIndexLifecycleEvent(type: string): boolean {
  return SESSION_INDEX_LIFECYCLE_EVENTS.has(type)
}

/** React-facing store: the value changes only when the Session rail should perform a fresh index read. */
export function sessionIndexInvalidationRevision(): number {
  return invalidationRevision
}

export function subscribeSessionIndexInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}

export function noteSessionIndexLiveEvent(
  config: Pick<ServerConfig, "host" | "port" | "username" | "backend">,
  event: LiveEvent,
  now = Date.now()
): void {
  const invalidates = sessionIndexLifecycleEvent(event.type)
  if (!event.sessionID) {
    if (invalidates) invalidateSessionIndex()
    return
  }

  const key = endpointKey(config)
  pruneLiveStatuses(key, now)
  pruneLiveErrors(key, now)
  if (event.type === "session.deleted") {
    deleteSessionState(key, event.sessionID)
    if (invalidates) invalidateSessionIndex()
    return
  }

  let status: SessionStatus | undefined
  if (event.type === "session.idle") status = { type: "idle" }
  else if (event.type === "session.status" && event.status) {
    status = {
      type: event.status,
      ...(event.statusAttempt !== undefined ? { attempt: event.statusAttempt } : {}),
      ...(event.statusMessage ? { message: event.statusMessage } : {}),
      ...(event.statusNext !== undefined ? { next: event.statusNext } : {})
    }
  }

  if (status) {
    const bySession = liveStatuses.get(key) ?? new Map<string, LiveStatus>()
    bySession.set(event.sessionID, { status, observedAt: now })
    liveStatuses.set(key, bySession)
    // A real retry/busy edge proves that an earlier terminal-looking error was not final.
    if (status.type === "busy" || status.type === "retry") {
      liveErrors.get(key)?.delete(event.sessionID)
      if (liveErrors.get(key)?.size === 0) liveErrors.delete(key)
    }
  }

  if (event.type === "session.error" && event.errorMessage) {
    const bySession = liveErrors.get(key) ?? new Map<string, LiveError>()
    bySession.set(event.sessionID, { message: event.errorMessage, observedAt: now })
    liveErrors.set(key, bySession)
  }

  // External-store subscribers must only be notified after the related lifecycle cache is coherent.
  if (invalidates) invalidateSessionIndex()
}

/** A reconnect means lifecycle edges may have been missed; discard transient authority and re-read. */
export function noteSessionIndexStreamConnected(
  config: Pick<ServerConfig, "host" | "port" | "username" | "backend">
): void {
  const key = endpointKey(config)
  liveStatuses.delete(key)
  liveErrors.delete(key)
  invalidateSessionIndex()
}

export function liveSessionIndexError(
  config: Pick<ServerConfig, "host" | "port" | "username" | "backend">,
  sessionID: string,
  now = Date.now()
): string | undefined {
  const key = endpointKey(config)
  pruneLiveErrors(key, now)
  return liveErrors.get(key)?.get(sessionID)?.message
}

export function liveSessionIndexStatus(
  config: Pick<ServerConfig, "host" | "port" | "username" | "backend">,
  sessionID: string,
  now = Date.now()
): SessionStatus | undefined {
  const key = endpointKey(config)
  pruneLiveStatuses(key, now)
  pruneLiveErrors(key, now)
  const status = liveStatuses.get(key)?.get(sessionID)?.status
  const error = liveErrors.get(key)?.get(sessionID)?.message
  // A terminal lifecycle error must beat a trailing idle status in the rail. A later busy/retry
  // edge clears the cached error above, so automatic provider recovery still wins immediately.
  if (error && !status?.type?.match(/^(busy|retry)$/)) return { type: "error", message: error }
  return status
}
