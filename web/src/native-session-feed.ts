import { api, type MessagePage } from "./api"
import { mergeLatestMessagePage, prependOlderMessagePage } from "./message-pages"
import { normalizeNativeSessionTurns } from "./native-session-turns"
import type { MessageEnvelope, MessagePart } from "./types"
import type { NativeSessionHistoryEntry, NativeSessionSurfaceTarget } from "./native-session-discovery"

export type NativeSessionFeed = {
  messages: MessageEnvelope[]
  before?: string
  hasMore: boolean
}

export type NativeSessionFeedApi = Pick<typeof api, "loadMessagePage">

function normalizedMessages(page: MessagePage): MessageEnvelope[] {
  return normalizeNativeSessionTurns(page.messages)
}

function historyMessage(entry: NativeSessionHistoryEntry, message: MessageEnvelope): MessageEnvelope {
  const id = `history:${entry.ref.agentID}:${entry.ref.sessionID}:${message.info.id}`
  const parts: MessagePart[] = (message.parts || []).map((part) => ({
    ...part,
    id: `history:${entry.ref.sessionID}:${part.id}`,
    messageID: id
  }))
  return {
    ...message,
    info: {
      ...message.info,
      id,
      sessionID: entry.ref.sessionID
    },
    parts,
    taskdesk: {
      kind: "native",
      agentId: entry.agentID,
      agentLabel: entry.agentLabel,
      agentBackend: entry.backend
    }
  } as MessageEnvelope
}

function historyMessages(target: NativeSessionSurfaceTarget): MessageEnvelope[] {
  return (target.history || []).flatMap((entry) => entry.messages.map((message) => historyMessage(entry, message)))
}

function historyMessageCount(target: NativeSessionSurfaceTarget): number {
  return (target.history || []).reduce((total, entry) => total + entry.messages.length, 0)
}

function currentMessages(target: NativeSessionSurfaceTarget, messages: MessageEnvelope[]): MessageEnvelope[] {
  const count = historyMessageCount(target)
  return count ? messages.slice(count) : messages
}

function existingHistory(target: NativeSessionSurfaceTarget, messages: MessageEnvelope[]): MessageEnvelope[] {
  const count = historyMessageCount(target)
  return count ? messages.slice(0, count) : []
}

function initialMessages(target: NativeSessionSurfaceTarget, messages: MessageEnvelope[]): MessageEnvelope[] {
  const history = historyMessages(target)
  return history.length ? [...history, ...messages] : messages
}

function asFeed(target: NativeSessionSurfaceTarget, page: MessagePage): NativeSessionFeed {
  return {
    messages: initialMessages(target, normalizedMessages(page)),
    before: page.before,
    hasMore: page.hasMore
  }
}

/**
 * Load the newest transcript page for one real native Session.
 *
 * Session-first deliberately follows the stabilized v3 Conversation controller here: the normal
 * native message endpoint remains the transcript authority before and after writer acquisition.
 * Switching a claimed ACP Session to a separate replay/cache authority caused real PI/Codex output
 * to be merged repeatedly when replay envelope ids changed between refreshes.
 *
 * `refreshHistory` is retained in the public signature only for compatibility with callers created
 * during the Session-first draft. It is intentionally ignored until an adapter can prove a stable,
 * single-authority replacement path.
 */
export async function loadNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  client: NativeSessionFeedApi = api,
  limit = 200,
  _refreshHistory = false
): Promise<NativeSessionFeed> {
  return asFeed(target, await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    undefined,
    limit,
    false
  ))
}

/**
 * Refresh only the newest page and preserve object identity for unchanged logical turns. Earlier
 * linked native Sessions stay immutable at the front of the same feed, while only the current
 * Session tail is reconciled. Keeping the inherited prefix object-identical is important on Android:
 * polling B must not rerender a long A transcript while the user is typing.
 */
export async function refreshNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  current: NativeSessionFeed,
  client: NativeSessionFeedApi = api,
  limit = 200,
  _refreshHistory = false
): Promise<NativeSessionFeed> {
  const page = await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    undefined,
    limit,
    false
  )
  const existingCurrent = currentMessages(target, current.messages)
  const mergedCurrent = mergeLatestMessagePage(existingCurrent, normalizedMessages(page))
  const unchanged = mergedCurrent === existingCurrent
    && page.before === current.before
    && page.hasMore === current.hasMore
  if (unchanged) return current
  const history = existingHistory(target, current.messages)
  return {
    messages: history.length ? [...history, ...mergedCurrent] : mergedCurrent,
    before: page.before,
    hasMore: page.hasMore
  }
}

/**
 * Load one older page for the current Session. Older B messages are inserted after inherited A
 * history, never before it, so paging cannot scramble the cross-agent conversation chronology.
 */
export async function loadOlderNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  current: NativeSessionFeed,
  client: NativeSessionFeedApi = api,
  limit = 500,
  _refreshHistory = false
): Promise<NativeSessionFeed> {
  if (!current.hasMore || !current.before) return current
  const page = await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    current.before,
    limit,
    false
  )
  const existingCurrent = currentMessages(target, current.messages)
  const mergedCurrent = prependOlderMessagePage(existingCurrent, normalizedMessages(page))
  const unchanged = mergedCurrent === existingCurrent
    && page.before === current.before
    && page.hasMore === current.hasMore
  if (unchanged) return current
  const history = existingHistory(target, current.messages)
  return {
    messages: history.length ? [...history, ...mergedCurrent] : mergedCurrent,
    before: page.before,
    hasMore: page.hasMore
  }
}
