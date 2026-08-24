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
import { loadPendingNativeSessionPrompt, sendNativeSessionPrompt } from "../native-session-prompt"
import { stopNativeSession } from "../native-session-stop"
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
 * Sessions whose discovery transport cannot prove writer ownership start in observe mode.
 * "Continue this Session" performs a safe claim first; only after that succeeds does the normal HR3
 * composer appear. Sending and Stop then target the exact same native session id through durable
 * machine-scoped operation paths. No Task, Run or replacement Session is created.
 */
export function NativeSessionObserver({ target, onSessionRefresh }: Props) {
  const [feed, setFeed] = useState<NativeSessionFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [statusType, setStatusType] = useState(target.status?.type || "idle")
  const [writeState, setWriteState] = useState<WriteState>(target.requiresExplicitClaim ? "observe" : "ready")
  const [resumeError, setResumeError] = useState<string | null>(null)
  const feedRef = useRef<NativeSessionFeed | null>(null)
  feedRef.current = feed

  const working = nativeSessionIsWorking(statusType)
  const writable = writeState === "ready"
  const profile = useMemo(() => ({
    id: target.key,
    name: target.agentLabel,
    config: target.config
  }), [target.key, target.agentLabel, target.config])
  const activeTurnToken = useMemo(() => {
    const messages = feed?.messages || []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.info.role === "user" && messages[index]?.info.id) return messages[index].info.id
    }
    return target.sessionID
  }, [feed?.messages, target.sessionID])

  const refreshStatus = useCallback(async () => {
    try {
      const statuses = await api.listStatuses(target.config, target.directory)
      const next = statuses[target.sessionID]?.type
      if (typeof next === "string" && next) setStatusType(next)
    } catch {
      // Activity status is lightweight enrichment. Transcript/history failures remain visible through
      // their own path and a transient status read must never replace the last known state.
    }
  }, [target.config, target.directory, target.sessionID])

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
    setStopping(false)
    setStatusType(target.status?.type || "idle")
    // If an HTTP response was lost, keep exactly the text and clientRequestId that may already have
    // been accepted. Retrying after a WebView reload then converges on the daemon ledger instead of
    // creating a second native prompt.
    setDraft(loadPendingNativeSessionPrompt(target)?.text ?? "")
    setWriteState(target.requiresExplicitClaim ? "observe" : "ready")
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
    void refreshStatus()
    return () => { cancelled = true }
  }, [target.key, refreshStatus])

  useEffect(() => {
    const live = startTaskDeskSessionLiveRefresh({
      targets: [{ key: target.key, profile, config: target.config }],
      getSelected: () => ({ targetKey: target.key, sessionID: target.sessionID }),
      onMessage: () => {
        void refreshTail(false)
        void refreshStatus()
      },
      onIndex: () => {
        void refreshStatus()
        onSessionRefresh?.()
      },
      onDetail: () => {
        void refreshTail(true)
        void refreshStatus()
      }
    })
    const timer = window.setInterval(() => {
      void refreshTail(false)
      void refreshStatus()
    }, IDLE_RECONCILE_MS)
    return () => {
      live.close()
      window.clearInterval(timer)
    }
  }, [profile, refreshStatus, refreshTail, target.config, target.key, target.sessionID, onSessionRefresh])

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
    if (writeState !== "observe") return
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
      const result = await sendNativeSessionPrompt(target, text)
      if (result.status === "accepted") {
        setDraft("")
      } else {
        setError(`Prompt delivery is ${result.status}. Harness Remote will not send it again with a new request id; refresh the transcript or retry the same prompt to reconcile safely.`)
      }
      onSessionRefresh?.()
      await Promise.all([refreshTail(false), refreshStatus()])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (target.requiresExplicitClaim && /session|load|writer|locked|busy|owned/i.test(message)) {
        setWriteState("observe")
        setResumeError(message)
      }
    } finally {
      setSending(false)
    }
  }

  async function stop() {
    if (!working || !writable || !target.canStop || stopping) return
    setStopping(true)
    setError(null)
    try {
      const result = await stopNativeSession(target, activeTurnToken)
      if (result.status !== "accepted") {
        setError(`Stop delivery is ${result.status}. Harness Remote will not send another native cancel with a new request id; the Session status will be reconciled instead.`)
      }
      onSessionRefresh?.()
      await Promise.all([refreshTail(true), refreshStatus()])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (target.requiresExplicitClaim && /claim|session|writer|owned/i.test(message)) {
        setWriteState("observe")
        setResumeError(message)
      }
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className={`hr-native-session-observer${writable ? " writable" : " observe-only"}`}>
      {error ? <div className="tdw-field-note hr-native-session-observer-error" role="status">Showing the last known Session transcript. Request failed: {error}</div> : null}
      {!writable ? (
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
          onStop={target.canStop && writable ? stop : undefined}
          stopping={stopping}
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
