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

/** Load the first transcript page for one real native Session. */
export async function loadNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  client: NativeSessionFeedApi = api,
  limit = 200
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
 * merge rule used by the current HR3 conversation controller, so Session-first observation cannot
 * reintroduce the long-transcript typing/render regressions fixed in v3.
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

/** Load one older page without disturbing the currently rendered tail or scroll identities. */
export async function loadOlderNativeSessionFeed(
  target: NativeSessionSurfaceTarget,
  current: NativeSessionFeed,
  client: NativeSessionFeedApi = api,
  limit = 500
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
