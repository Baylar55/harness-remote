import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../api"
import { latestConversationAttention } from "../conversation-turn-state"
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
import { taskClient } from "../taskClient"
import type { ModelOption, ModelSelection } from "../types"
import { LoadingIcon, RefreshIcon } from "../Icons"
import { ModelSelectionControl, type ModelSelectionLabels } from "./model-selection-control"
import { TaskDeskConversation } from "./taskdesk-conversation"
import "../native-session-observer.css"

const IDLE_RECONCILE_MS = 30_000

type WriteState = "observe" | "probing" | "ready"

const MODEL_LABELS: ModelSelectionLabels = {
  select: "Model and effort",
  searchPlaceholder: "Search models",
  searchEmpty: "No matching models.",
  defaultBadge: "Default",
  provider: (provider) => `Provider: ${provider}`,
  context: (context, output) => `Context: ${context} · Output: ${output}`,
  toolsYes: "Tools supported",
  toolsNo: "Tools unavailable",
  variant: (variant) => `Variant: ${variant}`
}

export function nativeSessionIsWorking(status?: string): boolean {
  const value = status?.trim().toLowerCase() || ""
  return value === "busy" || value === "running" || value === "working" || value === "in_progress" || value === "in-progress"
}

function sameModel(left: ModelSelection | null, right: ModelSelection): boolean {
  return Boolean(left)
    && left!.providerID === right.providerID
    && left!.modelID === right.modelID
    && (left!.variant || "") === (right.variant || "")
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
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(target.model)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  const [promptUnresolved, setPromptUnresolved] = useState(false)
  const feedRef = useRef<NativeSessionFeed | null>(null)
  const writeStateRef = useRef<WriteState>(writeState)
  feedRef.current = feed
  writeStateRef.current = writeState

  const working = nativeSessionIsWorking(statusType)
  const writable = writeState === "ready"
  const attention = useMemo(() => latestConversationAttention(feed?.messages || [], { active: working }), [feed?.messages, working])
  const activeModelOption = useMemo(() => selectedModel
    ? modelOptions.find((option) => sameModel(selectedModel, option)) ?? null
    : null, [modelOptions, selectedModel])
  const modelLabel = activeModelOption
    ? [activeModelOption.modelName, activeModelOption.variant].filter(Boolean).join(" · ")
    : selectedModel ? [selectedModel.modelID, selectedModel.variant].filter(Boolean).join(" · ") : "Choose model"
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

  const loadModels = useCallback(async () => {
    if (!target.modelsSupported) return
    setModelLoading(true)
    setModelError(null)
    try {
      // This is the machine daemon's technical catalog. It is read-only and independent from writer
      // claim, so merely opening a Session or its model sheet cannot acquire that Session.
      const catalog = await taskClient.listAgentModels(target.config, target.agentID)
      setModelOptions(catalog.models)
      setSelectedModel((current) => {
        if (current && catalog.models.some((option) => sameModel(current, option))) return current
        const sessionMatch = target.model && catalog.models.find((option) => sameModel(target.model, option))
        return sessionMatch ?? catalog.models.find((option) => option.isDefault) ?? catalog.models[0] ?? current
      })
      if (catalog.error) setModelError(catalog.error)
    } catch (reason) {
      setModelError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setModelLoading(false)
    }
  }, [target.agentID, target.config, target.key, target.model, target.modelsSupported])

  const refreshTail = useCallback(async (refreshHistory = false) => {
    const current = feedRef.current
    if (!current) return
    try {
      // Before an ACP claim, the journal is the safe read authority. After a successful claim the
      // ACP replay/live cache becomes authoritative for this controller. Never switch an idle claimed
      // Session back to journal paging: journal and live envelopes intentionally use different ids,
      // and merging those two authorities is how one native Codex reply was rendered twice.
      const keepOwnedAuthority = writeStateRef.current === "ready" && target.transport === "acp"
      const next = await refreshNativeSessionFeed(target, current, undefined, 200, refreshHistory || keepOwnedAuthority)
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
    const pending = loadPendingNativeSessionPrompt(target)
    // If an HTTP response was lost, keep exactly the text, model and clientRequestId that may already
    // have been accepted. Retrying after a WebView reload then converges on the daemon ledger instead
    // of creating a second native prompt with a different effort selection.
    setDraft(pending?.text ?? "")
    setSelectedModel(pending?.model ?? target.model)
    setPromptUnresolved(Boolean(pending))
    setModelOptions([])
    setModelError(null)
    setModelSheetOpen(false)
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
    void loadModels()
    return () => { cancelled = true }
  }, [target.key, refreshStatus, loadModels])

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
      const keepOwnedAuthority = writeStateRef.current === "ready" && target.transport === "acp"
      const next = await loadOlderNativeSessionFeed(target, current, undefined, 500, keepOwnedAuthority)
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
      if (target.transport === "acp") {
        try {
          // Claiming an external ACP Session changes transcript authority. Replace the current
          // journal-backed page once with the claimed ACP replay/cache instead of merging IDs from
          // two sources. From this point all tail/older refreshes stay on the owned authority.
          const next = await loadNativeSessionFeed(target, undefined, 200, true)
          feedRef.current = next
          setFeed(next)
        } catch (reason) {
          setWriteState("observe")
          setResumeError(`The Session was claimed but its transcript could not be reconciled safely: ${reason instanceof Error ? reason.message : String(reason)}`)
          return
        }
      }
      setWriteState("ready")
      void refreshStatus()
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
      const result = await sendNativeSessionPrompt(target, text, selectedModel)
      if (result.status === "accepted") {
        setDraft("")
        setPromptUnresolved(false)
      } else {
        setPromptUnresolved(true)
        setError(`Prompt delivery is ${result.status}. Harness Remote will not send it again with a new request id; refresh the transcript or retry the same prompt to reconcile safely.`)
      }
      onSessionRefresh?.()
      await Promise.all([refreshTail(false), refreshStatus()])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      setPromptUnresolved(Boolean(loadPendingNativeSessionPrompt(target)))
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
    <div className={`hr-native-session-observer tdw-work-thread-conversation${writable ? " writable" : " observe-only"}`}>
      {error ? <div className="tdw-field-note hr-native-session-observer-error" role="status">Showing the last known Session transcript. Request failed: {error}</div> : null}
      {attention ? <div className="tdw-field-note" role="status"><strong>Needs attention.</strong> {attention.title}. Review the latest turn below before continuing.</div> : null}
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
      {target.modelsSupported ? (
        <section className="session-context-strip hr-native-session-context" aria-label="Native Session controls">
          <button
            type="button"
            className={`context-chip${modelError && !activeModelOption ? " chip-warning" : ""}`}
            onClick={() => setModelSheetOpen(true)}
            disabled={modelLoading && modelOptions.length === 0}
          >
            <span>Model</span>
            <strong>{modelLoading && modelOptions.length === 0 ? "Loading…" : modelLabel}</strong>
          </button>
        </section>
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

      {modelSheetOpen && target.modelsSupported ? (
        <div className="sheet-backdrop" role="presentation">
          <section className="bottom-sheet fade-in" role="dialog" aria-modal="true" aria-labelledby="native-model-sheet-title">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <h3 id="native-model-sheet-title">Model and effort</h3>
                <p className="subtle">Selection applies to the next prompt in this same native Session.</p>
              </div>
              <button type="button" className="btn-secondary compact" onClick={() => setModelSheetOpen(false)}>Close</button>
            </div>
            <div className="sheet-content">
              <button type="button" className="btn-secondary" onClick={() => void loadModels()} disabled={modelLoading}>
                {modelLoading ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
                Refresh
              </button>
              {modelOptions.length > 0 ? (
                <ModelSelectionControl
                  options={modelOptions}
                  value={selectedModel}
                  onChange={(option) => setSelectedModel(option)}
                  disabled={working || sending || promptUnresolved}
                  labels={MODEL_LABELS}
                />
              ) : (
                <p className="subtle">{modelError || (modelLoading ? "Loading models…" : "No models are available for this harness.")}</p>
              )}
              {promptUnresolved ? <p className="subtle">Model and effort are locked until the unresolved prompt is reconciled.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
