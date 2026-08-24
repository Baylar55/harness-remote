import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../api"
import {
  loadNativeSessionFeed,
  loadOlderNativeSessionFeed,
  refreshNativeSessionFeed,
  type NativeSessionFeed
} from "../native-session-feed"
import { probeNativeSessionContinuation } from "../native-session-continuation"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import { startTaskDeskSessionLiveRefresh } from "../taskdesk-session-live-refresh"
import { LoadingIcon } from "../Icons"
import { TaskDeskConversation } from "./taskdesk-conversation"
import "../native-session-observer.css"

const IDLE_RECONCILE_MS = 30_000

type WriteState = "observe" | "probing" | "ready"

export function nativeSessionIsWorking(status?: string): boolean {
  const value = status?.trim().toLowerCase() || ""
  return value === "busy" || value === "running" || value === "working" || value === "in_progress" || value === "in-progress"
}

type Props = {
  target: NativeSessionSurfaceTarget
  onSessionRefresh?: () => void
}

/**
 * Controller for one real native Session. It deliberately renders the existing HR3 chat component:
 * Session-first changes what feeds the chat, not the chat UI.
 *
 * External Sessions start in observe mode. "Continue this Session" performs a safe resume probe
 * first; only after that succeeds does the normal HR3 composer appear. Sending then targets the
 * exact same native session id through the existing prompt_async path. No Task, Run or replacement
 * Session is created as part of continuation.
 */
export function NativeSessionObserver({ target, onSessionRefresh }: Props) {
  const [feed, setFeed] = useState<NativeSessionFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [writeState, setWriteState] = useState<WriteState>(target.external ? "observe" : "ready")
  const [resumeError, setResumeError] = useState<string | null>(null)
  const feedRef = useRef<NativeSessionFeed | null>(null)
  feedRef.current = feed

  const working = nativeSessionIsWorking(target.status?.type)
  const writable = writeState === "ready"
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
    setResumeError(null)
    setDraft("")
    setWriteState(target.external ? "observe" : "ready")
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

  async function enableContinuation() {
    if (working || writeState !== "observe") return
    setWriteState("probing")
    setResumeError(null)
    const result = await probeNativeSessionContinuation(target)
    if (result.writable) {
      setWriteState("ready")
      return
    }
    setWriteState("observe")
    setResumeError(result.reason || `${target.agentLabel} did not allow this Session to be resumed.`)
  }

  async function send() {
    const text = draft.trim()
    if (!text || !writable || working || sending) return
    setSending(true)
    setError(null)
    try {
      await api.sendPrompt(target.config, target.sessionID, text, target.directory)
      setDraft("")
      onSessionRefresh?.()
      await refreshTail(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (target.external && /session|load|writer|locked|busy|owned/i.test(message)) {
        setWriteState("observe")
        setResumeError(message)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`hr-native-session-observer${writable ? " writable" : " observe-only"}`}>
      {error ? <div className="tdw-field-note hr-native-session-observer-error" role="status">Showing the last known Session transcript. Request failed: {error}</div> : null}
      {!writable && !working ? (
        <div className="hr-native-session-continuation" role="status">
          <div>
            <strong>Observing this native Session</strong>
            <span>{resumeError || "Continue here when you want Harness Remote to use this same Session."}</span>
          </div>
          <button type="button" className="uw-button uw-button-primary" disabled={writeState === "probing"} onClick={() => void enableContinuation()}>
            {writeState === "probing" ? <LoadingIcon size={15} /> : null}
            {writeState === "probing" ? "Checking…" : "Continue this Session"}
          </button>
        </div>
      ) : null}
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
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          sending={sending}
          sendDisabled={!writable}
          workingLabel={`${target.agentLabel} is working`}
          placeholder={writable ? `Continue this ${target.agentLabel} Session…` : "Observe only"}
          emptyText="This Session has no messages yet."
          directory={target.directory}
          footerHint={writable ? "Continue the same native Session." : "Observe only until the harness confirms this Session can be resumed safely."}
        />
      )}
    </div>
  )
}
