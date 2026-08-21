import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../api"
import { mergeLatestMessagePage, prependOlderMessagePage } from "../message-pages"
import type { SavedServerProfile } from "../serverProfiles"
import {
  taskClient,
  type MachineTask,
  type MachineTaskRun
} from "../taskClient"
import { startTaskDeskSessionLiveRefresh } from "../taskdesk-session-live-refresh"
import type {
  BackendKind,
  MachineAgentHost,
  MessageEnvelope,
  ModelOption,
  ModelSelection,
  PermissionRequest,
  QuestionRequest,
  ServerConfig
} from "../types"
import {
  buildWorkThreadTimeline,
  runSessionID,
  workThreadRuns,
  type WorkThreadMessage,
  type WorkThreadAgentMeta
} from "../work-thread-timeline"
import { ModelPicker, modelOptionKey } from "./model-picker"
import { TaskDeskConversation } from "./taskdesk-conversation"
import { TaskDeskMessageContent } from "./taskdesk-message-content"
import { WorkThreadAttention } from "./work-thread-attention"

const INITIAL_PAGE_SIZE = 200
const OLDER_PAGE_SIZE = 500
const BACKGROUND_HISTORY_PAGES = 10
const ACTIVE_RECONCILE_MS = 1_000
const IDLE_RECONCILE_MS = 5_000
const DRAFT_STORAGE_PREFIX = "harness-remote.taskdesk.draft."

const HARNESS_ICON_FILES: Record<string, string> = {
  codex: "codex.svg",
  claude: "claude.svg",
  opencode: "opencode.svg",
  omp: "omp.svg",
  pi: "pi.svg"
}

type SessionTarget = {
  sessionID: string
  agentID: string
  directory: string
  config: ServerConfig
}

type SessionFeed = {
  messages: MessageEnvelope[]
  before?: string
  hasMore: boolean
}

type Props = {
  task: MachineTask
  baseConfig: ServerConfig
  agents: MachineAgentHost[]
  onTaskUpdate: (task: MachineTask) => void
  onWorkspaceRefresh?: () => void
}

function supportedBackend(value: string, fallback: BackendKind): BackendKind {
  return value === "opencode" || value === "omp" || value === "pi" || value === "claude" || value === "codex"
    ? value
    : fallback
}

function configForAgent(base: ServerConfig, agents: MachineAgentHost[], agentID: string): ServerConfig {
  const agent = agents.find((candidate) => candidate.id === agentID)
  return {
    ...base,
    backend: supportedBackend(agent?.backend || agentID, base.backend),
    agentId: agentID
  }
}

function agentForRun(task: MachineTask, run: MachineTaskRun | null | undefined): string {
  return run?.agentId || task.agentId
}

function agentMap(agents: MachineAgentHost[]): WorkThreadAgentMeta {
  return Object.fromEntries(agents.map((agent) => [agent.id, { label: agent.label, backend: agent.backend }]))
}

function agentLabel(agents: MachineAgentHost[], agentID: string): string {
  return agents.find((agent) => agent.id === agentID)?.label || agentID || "Coding agent"
}

function harnessIconUrl(backend: string | undefined): string | undefined {
  if (!backend) return undefined
  const file = HARNESS_ICON_FILES[backend.toLowerCase()]
  return file ? `${import.meta.env.BASE_URL}harness-icons/${file}` : undefined
}

function isActive(task: MachineTask): boolean {
  return task.status === "starting" || task.status === "running"
}

function modelKey(model?: ModelSelection | null): string {
  return model ? modelOptionKey(model as ModelOption) : ""
}

function lastModelForAgent(task: MachineTask, agentID: string): ModelSelection | null {
  const runs = workThreadRuns(task)
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (agentForRun(task, run) !== agentID || !run.model) continue
    return run.model
  }
  return task.agentId === agentID ? task.model ?? null : null
}

function sessionTargets(task: MachineTask, baseConfig: ServerConfig, agents: MachineAgentHost[]): SessionTarget[] {
  const bySession = new Map<string, SessionTarget>()
  for (const run of workThreadRuns(task)) {
    const session = runSessionID(run)
    if (!session || bySession.has(session)) continue
    const agentID = agentForRun(task, run)
    bySession.set(session, {
      sessionID: session,
      agentID,
      directory: run.directory || task.workspace.path,
      config: configForAgent(baseConfig, agents, agentID)
    })
  }
  return [...bySession.values()]
}

const WorkThreadBubble = memo(function WorkThreadBubble({ message }: { message: WorkThreadMessage }) {
  const meta = message.taskdesk
  if (message.info.role === "taskdesk") {
    return (
      <div className={`tdw-conversation-event ${meta?.kind === "error" ? "error" : ""}`} role={meta?.kind === "error" ? "alert" : undefined}>
        <span>{message.parts.find((part) => part.type === "text")?.text || "TaskDesk event"}</span>
      </div>
    )
  }
  const isUser = message.info.role === "user"
  const label = isUser ? "You" : meta?.agentLabel || "Coding agent"
  const icon = !isUser ? harnessIconUrl(meta?.agentBackend) : undefined
  return (
    <article className={`uw-message ${isUser ? "uw-message-user" : "uw-message-agent"}`}>
      <div className={`uw-avatar ${isUser ? "uw-avatar-user" : "uw-avatar-agent"}`} aria-hidden="true">
        {isUser ? "You" : icon ? <img src={icon} alt="" /> : label.slice(0, 2).toUpperCase()}
      </div>
      <div className="uw-message-body">
        <header>
          <strong>{label}</strong>
          <time>{message.info.time.created ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(message.info.time.created) : ""}</time>
        </header>
        <TaskDeskMessageContent message={message} />
      </div>
    </article>
  )
})

export function WorkThreadConversation({ task, baseConfig, agents, onTaskUpdate, onWorkspaceRefresh }: Props) {
  const draftStorageKey = `${DRAFT_STORAGE_PREFIX}${task.id}`
  const [feeds, setFeeds] = useState<Record<string, SessionFeed>>({})
  const feedsRef = useRef<Record<string, SessionFeed>>({})
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState(() => localStorage.getItem(draftStorageKey) || "")
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuestionRequest[]>([])
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [targetAgentID, setTargetAgentID] = useState(agentForRun(task, task.run))
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [targetModelKey, setTargetModelKey] = useState(modelKey(lastModelForAgent(task, agentForRun(task, task.run))))
  const loadGeneration = useRef(0)
  const modelGeneration = useRef(0)
  const targetAgentIDRef = useRef(targetAgentID)
  const sendInFlightRef = useRef(false)
  const stopInFlightRef = useRef(false)

  const targets = useMemo(() => sessionTargets(task, baseConfig, agents), [task.id, task.runs, task.run, task.workspace.path, baseConfig, agents])
  const targetSignature = targets.map((target) => `${target.sessionID}:${target.agentID}:${target.directory}`).join("|")
  const agentsByID = useMemo(() => agentMap(agents), [agents])
  const currentAgentID = agentForRun(task, task.run)
  const currentAgent = agents.find((agent) => agent.id === currentAgentID)
  const currentSessionID = runSessionID(task.run)
  const currentTarget = currentSessionID ? targets.find((target) => target.sessionID === currentSessionID) : undefined
  const working = isActive(task)

  useEffect(() => { feedsRef.current = feeds }, [feeds])
  useEffect(() => { targetAgentIDRef.current = targetAgentID }, [targetAgentID])
  useEffect(() => {
    if (draft) localStorage.setItem(draftStorageKey, draft)
    else localStorage.removeItem(draftStorageKey)
  }, [draft, draftStorageKey])

  useEffect(() => {
    setFeeds({})
    feedsRef.current = {}
    setLoading(true)
    setError(null)
    setQuestions([])
    setPermissions([])
    setTargetAgentID(currentAgentID)
    setTargetModelKey(modelKey(lastModelForAgent(task, currentAgentID)))
    sendInFlightRef.current = false
    stopInFlightRef.current = false
  }, [task.id])

  useEffect(() => {
    if (currentAgentID !== targetAgentIDRef.current && task.run?.id) {
      setTargetAgentID(currentAgentID)
      setTargetModelKey(modelKey(task.run.model ?? lastModelForAgent(task, currentAgentID)))
    }
  }, [currentAgentID, task.run?.id])

  const loadInitialTarget = useCallback(async (target: SessionTarget): Promise<SessionFeed> => {
    const page = await api.loadMessagePage(target.config, target.sessionID, target.directory, undefined, INITIAL_PAGE_SIZE, false)
    return { messages: page.messages, before: page.before, hasMore: page.hasMore }
  }, [])

  const fillOlderHistory = useCallback(async (target: SessionTarget, initial: SessionFeed, generation: number) => {
    let feed = initial
    let pages = 0
    while (feed.hasMore && feed.before && pages < BACKGROUND_HISTORY_PAGES) {
      const page = await api.loadMessagePage(target.config, target.sessionID, target.directory, feed.before, OLDER_PAGE_SIZE, false)
      feed = {
        messages: prependOlderMessagePage(feed.messages, page.messages),
        before: page.before,
        hasMore: page.hasMore
      }
      pages += 1
    }
    if (loadGeneration.current !== generation) return
    setFeeds((current) => ({ ...current, [target.sessionID]: feed }))
  }, [])

  useEffect(() => {
    const generation = ++loadGeneration.current
    let cancelled = false
    const missing = targets.filter((target) => !feedsRef.current[target.sessionID])
    if (missing.length === 0) {
      setLoading(false)
      return
    }
    if (Object.keys(feedsRef.current).length === 0) setLoading(true)
    void Promise.all(missing.map(async (target) => {
      try {
        const feed = await loadInitialTarget(target)
        if (cancelled || loadGeneration.current !== generation) return
        setFeeds((current) => ({ ...current, [target.sessionID]: feed }))
        void fillOlderHistory(target, feed, generation).catch(() => undefined)
      } catch (reason) {
        if (!cancelled && loadGeneration.current === generation) setError(reason instanceof Error ? reason.message : String(reason))
      }
    })).finally(() => {
      if (!cancelled && loadGeneration.current === generation) setLoading(false)
    })
    return () => { cancelled = true }
  }, [targetSignature, loadInitialTarget, fillOlderHistory])

  const messagesBySession = useMemo(() => Object.fromEntries(Object.entries(feeds).map(([session, feed]) => [session, feed.messages])), [feeds])
  const timeline = useMemo(() => buildWorkThreadTimeline(task, messagesBySession, agentsByID), [task, messagesBySession, agentsByID])
  const hasMore = Object.values(feeds).some((feed) => feed.hasMore && feed.before)

  const refreshCurrentTail = useCallback(async (sourceTask: MachineTask = task) => {
    const run = sourceTask.run
    const session = runSessionID(run)
    if (!session) return
    const agentID = agentForRun(sourceTask, run)
    const target: SessionTarget = {
      sessionID: session,
      agentID,
      directory: run?.directory || sourceTask.workspace.path,
      config: configForAgent(baseConfig, agents, agentID)
    }
    try {
      const page = await api.loadMessagePage(target.config, session, target.directory, undefined, INITIAL_PAGE_SIZE, false)
      setFeeds((current) => {
        const existing = current[session]
        return {
          ...current,
          [session]: existing
            ? { ...existing, messages: mergeLatestMessagePage(existing.messages, page.messages), hasMore: existing.hasMore || page.hasMore, before: existing.before || page.before }
            : { messages: page.messages, before: page.before, hasMore: page.hasMore }
        }
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [task, baseConfig, agents])

  const refreshAttention = useCallback(async (sourceTask: MachineTask = task) => {
    const run = sourceTask.run
    const session = runSessionID(run)
    if (!session) {
      setQuestions([])
      setPermissions([])
      return
    }
    const agentID = agentForRun(sourceTask, run)
    const config = configForAgent(baseConfig, agents, agentID)
    const directory = run?.directory || sourceTask.workspace.path
    const [nextQuestions, nextPermissions] = await Promise.all([
      api.loadQuestions(config, directory).catch(() => []),
      api.loadPermissions(config, directory).catch(() => [])
    ])
    setQuestions(nextQuestions.filter((request) => request.sessionID === session))
    setPermissions(nextPermissions.filter((request) => request.sessionID === session))
  }, [task, baseConfig, agents])

  const reconcile = useCallback(async () => {
    try {
      let next = await taskClient.getWorkThread(baseConfig, task.id)
      onTaskUpdate(next)
      await Promise.all([refreshCurrentTail(next), refreshAttention(next)])
      const hasRunCheckpoint = Boolean(next.run?.id && next.checkpoints?.some((checkpoint) => checkpoint.kind === "after-run" && checkpoint.runId === next.run?.id))
      if (next.workspace.mode === "worktree" && !isActive(next) && next.run?.id && next.run.finishedAt && !hasRunCheckpoint) {
        try {
          const created = await taskClient.createCheckpoint(baseConfig, next.id, {
            label: `After ${agentLabel(agents, agentForRun(next, next.run))}`,
            kind: "after-run",
            runId: next.run.id
          })
          if (created) {
            next = await taskClient.getWorkThread(baseConfig, task.id)
            onTaskUpdate(next)
            onWorkspaceRefresh?.()
          }
        } catch {
          // Checkpoints are a product bonus for managed Git workspaces, never a chat blocker.
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [baseConfig, task.id, agents, onTaskUpdate, onWorkspaceRefresh, refreshCurrentTail, refreshAttention])

  useEffect(() => {
    void refreshAttention()
    const delay = working ? ACTIVE_RECONCILE_MS : IDLE_RECONCILE_MS
    const timer = window.setInterval(() => void reconcile(), delay)
    return () => window.clearInterval(timer)
  }, [working, reconcile, refreshAttention])

  useEffect(() => {
    if (!currentTarget) return
    const profile: SavedServerProfile = {
      id: `thread:${task.id}:${currentTarget.agentID}`,
      name: agentLabel(agents, currentTarget.agentID),
      config: currentTarget.config
    }
    const subscription = startTaskDeskSessionLiveRefresh({
      targets: [{ key: profile.id, profile, config: currentTarget.config }],
      getSelected: () => ({ targetKey: profile.id, sessionID: currentTarget.sessionID }),
      onMessage: () => void refreshCurrentTail(),
      onIndex: () => void reconcile(),
      onDetail: () => void refreshAttention()
    })
    return () => subscription.close()
  }, [task.id, currentTarget?.sessionID, currentTarget?.agentID, currentTarget?.directory, refreshCurrentTail, reconcile, refreshAttention])

  useEffect(() => {
    const current = ++modelGeneration.current
    if (!targetAgentID) {
      setModels([])
      setTargetModelKey("")
      return
    }
    setModelsLoading(true)
    setError(null)
    void taskClient.listAgentModels(baseConfig, targetAgentID).then((catalog) => {
      if (modelGeneration.current !== current) return
      setModels(catalog.models)
      const prior = lastModelForAgent(task, targetAgentID)
      const priorKey = modelKey(prior)
      const chosen = catalog.models.find((model) => modelKey(model) === priorKey)
        || catalog.models.find((model) => model.isDefault)
        || catalog.models[0]
      setTargetModelKey(chosen ? modelKey(chosen) : priorKey)
    }).catch((reason) => {
      if (modelGeneration.current === current) {
        setModels([])
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }).finally(() => {
      if (modelGeneration.current === current) setModelsLoading(false)
    })
  }, [targetAgentID, task.id])

  const selectedModel = models.find((model) => modelKey(model) === targetModelKey) ?? lastModelForAgent(task, targetAgentID)

  async function loadOlder() {
    if (loadingOlder) return
    const olderTargets = targets.filter((target) => feedsRef.current[target.sessionID]?.hasMore && feedsRef.current[target.sessionID]?.before)
    if (olderTargets.length === 0) return
    setLoadingOlder(true)
    try {
      await Promise.all(olderTargets.map(async (target) => {
        const current = feedsRef.current[target.sessionID]
        if (!current?.before) return
        const page = await api.loadMessagePage(target.config, target.sessionID, target.directory, current.before, OLDER_PAGE_SIZE, false)
        setFeeds((feedsNow) => {
          const feed = feedsNow[target.sessionID] ?? current
          return {
            ...feedsNow,
            [target.sessionID]: {
              messages: prependOlderMessagePage(feed.messages, page.messages),
              before: page.before,
              hasMore: page.hasMore
            }
          }
        })
      }))
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending || working || sendInFlightRef.current) return
    // State updates are asynchronous. The ref closes the tiny window in which Enter and a click (or
    // two key events) could both reach this function before React re-rendered `sending=true`.
    sendInFlightRef.current = true
    setSending(true)
    setError(null)
    setDraft("")
    try {
      const latest = await taskClient.getWorkThread(baseConfig, task.id)
      if (isActive(latest)) {
        onTaskUpdate(latest)
        throw new Error(`${agentLabel(agents, agentForRun(latest, latest.run))} is still working. Stop it or wait for the reply before sending another message.`)
      }
      const next = await taskClient.continueTask(baseConfig, task.id, {
        prompt: text,
        agentId: targetAgentID,
        ...(selectedModel ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID, variant: selectedModel.variant } } : {})
      })
      localStorage.removeItem(draftStorageKey)
      onTaskUpdate(next)
      await refreshCurrentTail(next)
      void refreshAttention(next)
    } catch (reason) {
      setDraft((current) => current ? `${text}\n${current}` : text)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      sendInFlightRef.current = false
      setSending(false)
    }
  }

  async function stop() {
    if (stopping || !working || stopInFlightRef.current) return
    stopInFlightRef.current = true
    setStopping(true)
    setError(null)
    try {
      const next = await taskClient.cancelWorkThread(baseConfig, task.id)
      onTaskUpdate(next)
      await Promise.all([refreshCurrentTail(next), refreshAttention(next)])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      stopInFlightRef.current = false
      setStopping(false)
    }
  }

  const currentLabel = agentLabel(agents, currentAgentID)
  const waitingLabel = questions.length || permissions.length ? "Waiting for your input" : `${currentLabel} is working`

  return (
    <div className="tdw-work-thread-conversation">
      <div className="tdw-conversation-toolbar">
        <div className="tdw-agent-control">
          <label>
            <span>Coding agent</span>
            <select value={targetAgentID} disabled={working || sending} onChange={(event) => setTargetAgentID(event.target.value)}>
              {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.label}</option>)}
            </select>
          </label>
          <label className="tdw-model-control">
            <span>Model</span>
            <ModelPicker compact models={models} value={targetModelKey} onChange={setTargetModelKey} disabled={working || sending} loading={modelsLoading} />
          </label>
        </div>
        <span className={`tdw-conversation-state ${working ? "working" : questions.length || permissions.length ? "attention" : "ready"}`}>
          <i />{working ? waitingLabel : questions.length || permissions.length ? "Needs your input" : "Ready"}
        </span>
      </div>

      <WorkThreadAttention
        config={currentTarget?.config || configForAgent(baseConfig, agents, currentAgentID)}
        directory={currentTarget?.directory || task.workspace.path}
        questions={questions}
        permissions={permissions}
        onResolved={async () => { await refreshAttention(); await reconcile() }}
      />

      {error ? <div className="tdw-chat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}

      <TaskDeskConversation
        messages={timeline}
        agentLabel={currentLabel}
        agentBackend={currentAgent?.backend}
        loading={loading}
        ready={!loading}
        waiting={working}
        workingLabel={waitingLabel}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        sending={sending}
        sendDisabled={working || questions.length > 0 || permissions.length > 0}
        onStop={working ? stop : undefined}
        stopping={stopping}
        placeholder={`Message ${agentLabel(agents, targetAgentID)}…`}
        emptyText="Start talking to the coding agent. This Work Thread keeps the whole conversation together."
        footerHint={working ? "The agent is working on your last message" : undefined}
        renderMessage={(message) => <WorkThreadBubble key={message.info.id} message={message as WorkThreadMessage} />}
      />
    </div>
  )
}
