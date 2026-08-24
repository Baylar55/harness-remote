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
 * `refreshHistory=true` deliberately bypasses an adapter's paged journal fast-path. Session-first
 * uses that when an ACP Session has just been claimed: before the claim the harness journal is the
 * safe read authority, while after the claim the ACP connection's replay/live cache is the writer
 * authority. Replacing the feed once at that boundary prevents one native reply from being rendered
 * twice merely because journal and live envelopes use different ids.
 */
export async function loadNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  client: NativeSessionFeedApi = api,
  limit = 200,
  refreshHistory = false
): Promise<NativeSessionFeed> {
  return asFeed(await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    undefined,
    limit,
    refreshHistory
  ))
}

/**
 * Refresh only the newest page and preserve object identity for unchanged messages. This is the same
 * merge rule used by the current HR3 conversation controller, so Session-first observation cannot
 * reintroduce the long-transcript typing/render regressions fixed in v3.
 *
 * Claimed ACP Sessions pass `refreshHistory=true` so an idle refresh cannot silently switch the tail
 * back from live ACP envelopes to the harness journal, whose stable ids belong to a different source.
 */
export async function refreshNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  current: NativeSessionFeed,
  client: NativeSessionFeedApi = api,
  limit = 200,
  refreshHistory = false
): Promise<NativeSessionFeed> {
  const page = await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    undefined,
    limit,
    refreshHistory
  )
  const messages = mergeLatestMessagePage(current.messages, page.messages)
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore }
}

/**
 * Load one older page without disturbing the currently rendered tail or scroll identities.
 * Claimed ACP Sessions keep the same authority for older paging as for their live tail.
 */
export async function loadOlderNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  current: NativeSessionFeed,
  client: NativeSessionFeedApi = api,
  limit = 500,
  refreshHistory = false
): Promise<NativeSessionFeed> {
  if (!current.hasMore || !current.before) return current
  const page = await client.loadMessagePage(
    target.config,
    target.sessionID,
    target.directory,
    current.before,
    limit,
    refreshHistory
  )
  const messages = prependOlderMessagePage(current.messages, page.messages)
  if (messages === current.messages && page.before === current.before && page.hasMore === current.hasMore) return current
  return { messages, before: page.before, hasMore: page.hasMore }
}
