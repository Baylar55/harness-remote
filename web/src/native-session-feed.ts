import { api, type MessagePage } from "./api"
import { mergeLatestMessagePage, prependOlderMessagePage } from "./message-pages"
import { normalizeNativeSessionTurns } from "./native-session-turns"
import type { MessageEnvelope } from "./types"
import type { NativeSessionHistoryEntry, NativeSessionSurfaceTarget } from "./native-session-discovery"

export type NativeSessionFeed = {
  messages: MessageEnvelope[]
  before?: string
  hasMore: boolean
  /** Prefix owned by earlier linked native Sessions. Paging applies only to the current Session tail. */
  historyCount?: number
}

export type NativeSessionFeedApi = Pick<typeof api, "loadMessagePage">

function normalizedMessages(page: MessagePage): MessageEnvelope[] {
  return normalizeNativeSessionTurns(page.messages)
}

function historyMessages(entries: NativeSessionHistoryEntry[] | undefined): MessageEnvelope[] {
  return (entries || []).flatMap((entry) => entry.messages.map((message) => {
    // Message ids are only guaranteed inside their native Session. Prefix inherited ids so the v3
    // merge helpers cannot confuse an older Session message with a coincidentally equal target id.
    const id = `linked:${entry.ref.sessionID}:${message.info.id}`
    return {
      ...message,
      info: { ...message.info, id },
      parts: message.parts.map((part) => ({
        ...part,
        id: `linked:${entry.ref.sessionID}:${part.id}`,
        messageID: id
      }))
    }
  }))
}

function asFeed(target: NativeSessionSurfaceTarget, page: MessagePage): NativeSessionFeed {
  const history = historyMessages(target.history)
  const current = normalizedMessages(page)
  return {
    messages: history.length ? [...history, ...current] : current,
    before: page.before,
    hasMore: page.hasMore,
    historyCount: history.length
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
 * Refresh only the newest page and preserve object identity for unchanged logical turns. Inherited
 * linked history is already in `current` and the v3 identity merge leaves that prefix untouched.
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
  const messages = mergeLatestMessagePage(current.messages, normalizedMessages(page))
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore, historyCount: current.historyCount || 0 }
}

/**
 * Load one older logical-turn page for the current Session. Earlier linked Sessions remain before the
 * target Session instead of being pushed after newly loaded target history.
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
  const historyCount = current.historyCount || 0
  const history = historyCount ? current.messages.slice(0, historyCount) : []
  const targetMessages = historyCount ? current.messages.slice(historyCount) : current.messages
  const nextTargetMessages = prependOlderMessagePage(targetMessages, normalizedMessages(page))
  const messages = nextTargetMessages === targetMessages
    ? current.messages
    : history.length ? [...history, ...nextTargetMessages] : nextTargetMessages
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore, historyCount }
}
