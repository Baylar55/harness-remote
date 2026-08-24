import { api, type MessagePage } from "./api"
import { mergeLatestMessagePage, prependOlderMessagePage } from "./message-pages"
import type { MessageEnvelope } from "./types"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"

export type NativeSessionFeed = {
  messages: MessageEnvelope[]
  before?: string
  hasMore: boolean
}

export type NativeSessionFeedApi = Pick<typeof api, "loadMessagePage">

function asFeed(page: MessagePage): NativeSessionFeed {
  return {
    messages: page.messages,
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
  return asFeed(await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    undefined,
    limit,
    false
  ))
}

/**
 * Refresh only the newest page and preserve object identity for unchanged messages. This is the same
 * read + merge rule used by the validated v3 WorkThreadConversation path.
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
  const messages = mergeLatestMessagePage(current.messages, page.messages)
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore }
}

/** Load one older page using the same transcript authority as the live tail. */
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
  const messages = prependOlderMessagePage(current.messages, page.messages)
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore }
}
