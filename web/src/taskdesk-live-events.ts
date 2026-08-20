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
import type { SavedServerProfile } from "./serverProfiles"
import type { ServerConfig } from "./types"

export type TaskDeskLiveEvent = {
  type: string
  sessionID?: string
}

type Subscription = { close(): void }

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Normalize bridge-native and OpenCode event envelopes into the two fields TaskDesk needs. */
export function taskDeskLiveEvent(name: string | undefined, data: unknown): TaskDeskLiveEvent | null {
  const payload = eventPayload(data)
  if (!payload) return name ? { type: name } : null
  const properties = object(payload.properties)
  const info = object(properties?.info)
  const session = object(properties?.session)
  const type = eventType(data) ?? text(payload.type) ?? name
  if (!type) return null
  const sessionID = text(payload.sessionId)
    ?? text(payload.sessionID)
    ?? text(properties?.sessionId)
    ?? text(properties?.sessionID)
    ?? text(info?.sessionID)
    ?? text(info?.id)
    ?? text(session?.id)
  return { type, ...(sessionID ? { sessionID } : {}) }
}

/**
 * Use the transport already proven by Classic on each platform. Browser/Electron fetch streams can
 * carry auth headers, Android uses the native SSE plugin, and Electron main owns desktop sockets.
 */
export function subscribeTaskDeskLiveEvents({
  profile,
  config,
  onEvent,
  onStatus
}: {
  profile: SavedServerProfile
  config: ServerConfig
  onEvent: (event: TaskDeskLiveEvent) => void
  onStatus?: (status: EventStreamStatus) => void
}): Subscription {
  const emit = (name: string | undefined, data: unknown) => {
    const normalized = taskDeskLiveEvent(name, data)
    if (normalized) onEvent(normalized)
  }

  if (isDesktopPlatform()) {
    return createDesktopOpenCodeEventSubscription({
      profileId: profile.id,
      scope: "global",
      onEvent: (event) => emit(event.name, event.data),
      onStatus
    })
  }

  const stream = api.eventStream(config)
  if (isNativeEventTransport()) {
    return createNativeOpenCodeEventSubscription({
      url: stream.url,
      username: config.username,
      password: config.password,
      onEvent: (event) => emit(event.name, event.data),
      onStatus
    })
  }

  return createFetchOpenCodeEventSubscription({
    url: stream.url,
    headers: stream.headers,
    onEvent: (event) => emit(event.name, event.data),
    onStatus
  })
}
