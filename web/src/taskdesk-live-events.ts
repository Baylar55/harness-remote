import { api } from "./api"
import { createDesktopOpenCodeEventSubscription, isDesktopPlatform } from "./desktopBridge"
import {
  createFetchOpenCodeEventSubscription,
  createNativeOpenCodeEventSubscription,
  eventPayload,
  eventType,
  isNativeEventTransport,
  type EventStreamStatus
} from "./opencode-events"
import { noteSessionIndexLiveEvent, noteSessionIndexStreamConnected } from "./session-index-live-state"
import type { ServerConfig } from "./types"

export type TaskDeskLiveEvent = {
  type: string
  sessionID?: string
  status?: string
  statusMessage?: string
  statusAttempt?: number
  statusNext?: number
  errorMessage?: string
}

type Subscription = { close(): void }

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function lifecycleErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return text(value)
  const error = object(value)
  if (!error) return undefined
  const data = object(error.data)
  const nested = object(data?.error)
  return text(data?.message)
    ?? text(nested?.message)
    ?? text(error.message)
    ?? text(error.name)
}

/** Normalize bridge-native and OpenCode event envelopes into the fields TaskDesk needs. */
export function taskDeskLiveEvent(name: string | undefined, data: unknown): TaskDeskLiveEvent | null {
  const payload = eventPayload(data)
  if (!payload) return name ? { type: name } : null
  const properties = object(payload.properties)
  const info = object(properties?.info)
  const session = object(properties?.session)
  const part = object(properties?.part)
  const status = object(properties?.status)
  const type = eventType(data) ?? text(payload.type) ?? name
  if (!type) return null
  const sessionID = text(payload.sessionId)
    ?? text(payload.sessionID)
    ?? text(properties?.sessionId)
    ?? text(properties?.sessionID)
    ?? text(info?.sessionID)
    ?? text(info?.id)
    ?? text(session?.id)
    // Older OpenCode message.part.updated envelopes put the Session identity only on the part.
    // Keep this as transport normalization; the mature v3 renderer still owns reasoning semantics.
    ?? text(part?.sessionId)
    ?? text(part?.sessionID)
  const statusType = text(status?.type)
  const statusMessage = text(status?.message)
  const statusAttempt = finiteNumber(status?.attempt)
  const statusNext = finiteNumber(status?.next)
  const errorMessage = type === "session.error" ? lifecycleErrorMessage(properties?.error) : undefined
  return {
    type,
    ...(sessionID ? { sessionID } : {}),
    ...(statusType ? { status: statusType } : {}),
    ...(statusMessage ? { statusMessage } : {}),
    ...(statusAttempt !== undefined ? { statusAttempt } : {}),
    ...(statusNext !== undefined ? { statusNext } : {}),
    ...(errorMessage ? { errorMessage } : {})
  }
}

/**
 * Use the transport already proven by Classic on each platform. Browser and Electron fetch streams
 * can carry auth headers, Android uses the native SSE plugin, and Electron main owns desktop sockets.
 *
 * `trackSessionIndex` belongs to the long-lived machine subscription only. The selected Session also
 * owns a detail stream so it can refresh transcript/attention quickly, but opening or changing that
 * detail must never reset the shared rail lifecycle cache for every other Session on the endpoint.
 */
export function subscribeTaskDeskLiveEvents({
  config,
  onEvent,
  onStatus,
  trackSessionIndex = true
}: {
  config: ServerConfig
  onEvent: (event: TaskDeskLiveEvent) => void
  onStatus?: (status: EventStreamStatus) => void
  trackSessionIndex?: boolean
}): Subscription {
  const emit = (name: string | undefined, data: unknown) => {
    const normalized = taskDeskLiveEvent(name, data)
    if (!normalized) return
    if (trackSessionIndex) noteSessionIndexLiveEvent(config, normalized)
    onEvent(normalized)
  }
  const emitStatus = (status: EventStreamStatus) => {
    // Only the persistent machine stream owns rail authority. A selected-detail stream reports the
    // same transport lifecycle but is created/destroyed by navigation; treating its ordinary mount
    // as a reconnect used to wipe a retry from another Session as soon as the user opened this one.
    if (trackSessionIndex && status.type === "connected") noteSessionIndexStreamConnected(config)
    onStatus?.(status)
  }

  if (isDesktopPlatform()) {
    return createDesktopOpenCodeEventSubscription({
      config,
      scope: "global",
      onEvent: (event) => emit(event.name, event.data),
      onStatus: emitStatus
    })
  }

  const stream = api.eventStream(config)
  if (isNativeEventTransport()) {
    return createNativeOpenCodeEventSubscription({
      url: stream.url,
      username: config.username,
      password: config.password,
      backend: config.backend,
      onEvent: (event) => emit(event.name, event.data),
      onStatus: emitStatus
    })
  }

  return createFetchOpenCodeEventSubscription({
    url: stream.url,
    headers: stream.headers,
    onEvent: (event) => emit(event.name, event.data),
    onStatus: emitStatus
  })
}
