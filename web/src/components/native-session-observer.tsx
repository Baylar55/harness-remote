import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  loadNativeSessionFeed,
  loadOlderNativeSessionFeed,
  refreshNativeSessionFeed,
  type NativeSessionFeed
} from "../native-session-feed"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import { startTaskDeskSessionLiveRefresh } from "../taskdesk-session-live-refresh"
import { LoadingIcon } from "../Icons"
import { TaskDeskConversation } from "./taskdesk-conversation"
import "../native-session-observer.css"

const IDLE_RECONCILE_MS = 30_000

export function nativeSessionIsWorking(status?: string): boolean {
  const value = status?.trim().toLowerCase() || ""
  return value === "busy" || value === "running" || value === "working" || value === "in_progress" || value === "in-progress"
}

type Props = {
  target: NativeSessionSurfaceTarget
  onSessionRefresh?: () => void
}

/**
 * Read-only controller for a real native Session. The visual surface is intentionally the existing
 * HR3 TaskDeskConversation component: Session-first changes what feeds the chat, not the chat UI.
 *
 * Write/resume is deliberately not enabled here yet. Some harnesses have a single-writer lock and
 * must distinguish observing an externally-owned Session from acquiring it for continuation.
 */
export function NativeSessionObserver({ target, onSessionRefresh }: Props) {
  const [feed, setFeed] = useState<NativeSessionFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const feedRef = useRef<NativeSessionFeed | null>(null)
  feedRef.current = feed

  const working = nativeSessionIsWorking(target.status?.type)
  const profile = useMemo(() => ({
    id: target.key,
    name: target.agentLabel,
    config: target.config
  }), [target.key, target.agentLabel, target.config])

  const refreshTail = useCallback(async (refreshHistory = false) => {
    const current = feedRef.current
    if (!current) return
    try {
      const next = await refreshNativeSessionFeed(target, current, undefined, 200, refreshHistory)
      setFeed((visible) => visible === current ? next : visible)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [target])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFeed(null)
    feedRef.current = null
    void loadNativeSessionFeed(target).then((next) => {
      if (cancelled) return
      feedRef.current = next
      setFeed(next)
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [target.key])

  useEffect(() => {
    const live = startTaskDeskSessionLiveRefresh({
      targets: [{ key: target.key, profile, config: target.config }],
      getSelected: () => ({ targetKey: target.key, sessionID: target.sessionID }),
      onMessage: () => { void refreshTail(false) },
      onIndex: () => { onSessionRefresh?.() },
      onDetail: () => { void refreshTail(true) }
    })
    const timer = window.setInterval(() => { void refreshTail(false) }, IDLE_RECONCILE_MS)
    return () => {
      live.close()
      window.clearInterval(timer)
    }
  }, [profile, refreshTail, target.config, target.key, target.sessionID, onSessionRefresh])

  async function loadOlder() {
    const current = feedRef.current
    if (!current || loadingOlder) return
    setLoadingOlder(true)
    try {
      const next = await loadOlderNativeSessionFeed(target, current)
      feedRef.current = next
      setFeed((visible) => visible === current ? next : visible)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoadingOlder(false)
    }
  }

  return (
    <div className="hr-native-session-observer">
      {error ? <div className="tdw-field-note hr-native-session-observer-error" role="status">Showing the last known Session transcript. Refresh failed: {error}</div> : null}
      {loading && !feed ? (
        <div className="tdw-detail-loading"><LoadingIcon size={20} /> Loading Session…</div>
      ) : (
        <TaskDeskConversation
          messages={feed?.messages || []}
          agentLabel={target.agentLabel}
          agentBackend={target.backend}
          loading={false}
          waiting={working}
          ready={true}
          hasMore={feed?.hasMore || false}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          draft=""
          onDraftChange={() => undefined}
          onSend={() => undefined}
          sendDisabled={true}
          workingLabel={`${target.agentLabel} is working`}
          placeholder="Observe only"
          emptyText="This Session has no messages yet."
          directory={target.directory}
          footerHint="Observe only. Continuation is enabled only after the harness confirms this Session can be resumed safely."
        />
      )}
    </div>
  )
}
