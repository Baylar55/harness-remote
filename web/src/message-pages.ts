import type { MessageEnvelope } from "./types"

/**
 * Refresh the newest page without discarding older pages the user explicitly loaded.
 * Reuse existing message objects when the server did not replace them so memoized
 * transcript rows remain cheap while the composer and live status update.
 */
export function mergeLatestMessagePage(existing: MessageEnvelope[], latest: MessageEnvelope[]): MessageEnvelope[] {
  if (!existing.length) return latest
  const latestByID = new Map(latest.map((message) => [message.info.id, message]))
  const existingIDs = new Set(existing.map((message) => message.info.id))
  return [
    ...existing.map((message) => latestByID.get(message.info.id) ?? message),
    ...latest.filter((message) => !existingIDs.has(message.info.id))
  ]
}

/** Add an older page once, keeping the current tail and its object identities intact. */
export function prependOlderMessagePage(existing: MessageEnvelope[], older: MessageEnvelope[]): MessageEnvelope[] {
  if (!existing.length) return older
  const existingIDs = new Set(existing.map((message) => message.info.id))
  return [
    ...older.filter((message) => !existingIDs.has(message.info.id)),
    ...existing
  ]
}
