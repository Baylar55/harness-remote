import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api } from "../api"
import { discoverMachine, selectableMachineAgents } from "../machineClient"
import {
  taskClient,
  type MachineProject,
  type MachineTask,
  type MachineTaskRun,
  type TaskWorkspaceInspection
} from "../taskClient"
import {
  agentLabel,
  modelLabel,
  normalizeTaskStatus,
  sortTasksByActivity,
  taskStatusLabel,
  taskTitle,
  type TaskDeskTaskStatus
} from "../taskdeskHomeModel"
import type {
  DiffFile,
  MachineAgentHost,
  MachineSnapshot,
  MessageEnvelope,
  ModelOption,
  PermissionRequest,
  QuestionRequest,
  ServerConfig,
  TodoItem,
  VcsStatus
} from "../types"
import type { WorkspaceMachine } from "../workspaceMachines"
import {
  ChatIcon,
  CloseIcon,
  FolderIcon,
  LoadingIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ServerIcon
} from "../Icons"
import { UniversalWorkspace } from "./universal-workspace"

const REFRESH_MS = 4_000
const DETAIL_REFRESH_MS = 2_500
const REMARK_PLUGINS = [remarkGfm]

const HARNESS_ICON_FILES: Record<string, string> = {
  codex: "codex.svg",
  claude: "claude.svg",
  opencode: "opencode.svg",
  omp: "omp.svg",
  pi: "pi.svg"
}

type TaskDeskView = "overview" | "tasks" | "sessions" | "projects" | "needs" | "agents" | "machines" | "classic"
type TaskFilter = "all" | "running" | "waiting" | "completed" | "failed"
type DetailTab = "overview" | "conversation" | "diff" | "runs"

type RuntimeMachine = {
  key: string
  machine: WorkspaceMachine
  snapshot: MachineSnapshot | null
  projects: MachineProject[]
  tasks: MachineTask[]
  agents: MachineAgentHost[]
  state: "online" | "offline" | "loading"
  error?: string
}

type TaskRecord = {
  key: string
  runtime: RuntimeMachine
  task: MachineTask
}

type AttentionItem =
  | { key: string; type: "permission"; runtime: RuntimeMachine; agent: MachineAgentHost; request: PermissionRequest; task?: MachineTask }
  | { key: string; type: "question"; runtime: RuntimeMachine; agent: MachineAgentHost; request: QuestionRequest; task?: MachineTask }

type TaskDetail = {
  ownerKey: string | null
  loading: boolean
  messages: MessageEnvelope[]
  diff: DiffFile[]
  todos: TodoItem[]
  vcs: VcsStatus | null
  result: TaskWorkspaceInspection | null
  error: string | null
}

type Props = {
  machines: WorkspaceMachine[]
  activeMachineID: string
  onActiveMachineID: (id: string) => void
  onPersistMachines: (machines: WorkspaceMachine[]) => void
  onManageMachines: () => void
  legacyView: ReactNode
}

function supportedBackend(value: string, fallback: ServerConfig["backend"]): ServerConfig["backend"] {
  return value === "opencode" || value === "omp" || value === "pi" || value === "claude" || value === "codex"
    ? value
    : fallback
}

function configForAgent(runtime: RuntimeMachine, agent: MachineAgentHost): ServerConfig {
  return {
    ...runtime.machine.config,
    backend: supportedBackend(agent.backend, runtime.machine.config.backend),
    agentId: agent.id
  }
}

function harnessIconUrl(backend: string): string | undefined {
  const file = HARNESS_ICON_FILES[backend.toLowerCase()]
  return file ? `${import.meta.env.BASE_URL}harness-icons/${file}` : undefined
}

function HarnessBadge({ agent }: { agent: MachineAgentHost }) {
  const source = harnessIconUrl(agent.backend)
  return (
    <span className="td3-agent-badge" title={`${agent.label} · ${agent.transport}`}>
      {source ? <img src={source} alt="" aria-hidden="true" /> : <span>{agent.label.slice(0, 2).toUpperCase()}</span>}
      <b>{agent.label}</b>
      <i className={`td3-agent-state td3-agent-state-${agent.state}`} />
    </span>
  )
}

function runSessionID(run?: MachineTaskRun | null): string | null {
  return run?.sessionId || run?.sessionID || null
}

function formatRelative(value?: string): string {
  if (!value) return ""
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`
  return `${Math.round(delta / 86_400_000)}d ago`
}

function formatDate(value?: string): string {
  if (!value) return "Unknown"
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
    : value
}

function extractText(message: MessageEnvelope): string {
  return message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

function latestAssistantText(messages: MessageEnvelope[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info.role === "user") continue
    const text = extractText(messages[index])
    if (text) return text
  }
  return ""
}

function taskWorkspaceLabel(task: MachineTask): string {
  return task.workspace?.mode === "worktree" ? "Isolated worktree" : "Project directory"
}

function taskStatusTone(status: string): TaskDeskTaskStatus {
  return normalizeTaskStatus(status)
}

function filterMatches(status: string, filter: TaskFilter): boolean {
  if (filter === "all") return true
  const normalized = normalizeTaskStatus(status)
  if (filter === "running") return normalized === "running" || normalized === "preparing" || normalized === "queued"
  return normalized === filter
}

function taskRunHistory(task: MachineTask): MachineTaskRun[] {
  if (Array.isArray(task.runs) && task.runs.length) return task.runs
  return task.run ? [task.run] : []
}

function emptyDetail(ownerKey: string | null = null, loading = false): TaskDetail {
  return { ownerKey, loading, messages: [], diff: [], todos: [], vcs: null, result: null, error: null }
}

function taskForSession(runtime: RuntimeMachine, sessionID: string): MachineTask | undefined {
  return runtime.tasks.find((task) => taskRunHistory(task).some((run) => runSessionID(run) === sessionID))
}

function NewTaskModal({
  runtimes,
  initialMachineID,
  onClose,
  onCreated
}: {
  runtimes: RuntimeMachine[]
  initialMachineID: string
  onClose: () => void
  onCreated: (runtime: RuntimeMachine, task: MachineTask) => void
}) {
  const online = runtimes.filter((runtime) => runtime.state === "online" && runtime.snapshot)
  const first = online.find((runtime) => runtime.machine.id === initialMachineID) || online[0]
  const [machineID, setMachineID] = useState(first?.machine.id || "")
  const runtime = online.find((candidate) => candidate.machine.id === machineID) || first
  const agents = runtime?.agents || []
  const [projectID, setProjectID] = useState(runtime?.projects[0]?.id || "")
  const [agentID, setAgentID] = useState(agents[0]?.id || "")
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelKey, setModelKey] = useState("")
  const [modelsLoading, setModelsLoading] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [isolated, setIsolated] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modelGeneration = useRef(0)

  useEffect(() => {
    if (!runtime) return
    if (!runtime.projects.some((project) => project.id === projectID)) setProjectID(runtime.projects[0]?.id || "")
    if (!runtime.agents.some((agent) => agent.id === agentID)) setAgentID(runtime.agents[0]?.id || "")
  }, [machineID])

  useEffect(() => {
    if (!runtime || !agentID) {
      setModels([])
      setModelKey("")
      return
    }
    const generation = ++modelGeneration.current
    setModelsLoading(true)
    setError(null)
    void taskClient.listAgentModels(runtime.machine.config, agentID).then((catalog) => {
      if (generation !== modelGeneration.current) return
      setModels(catalog.models)
      const selected = catalog.models.find((model) => model.isDefault) || catalog.models[0]
      setModelKey(selected ? `${selected.providerID}|${selected.modelID}|${selected.variant || ""}` : "")
    }).catch((reason) => {
      if (generation === modelGeneration.current) {
        setModels([])
        setModelKey("")
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }).finally(() => {
      if (generation === modelGeneration.current) setModelsLoading(false)
    })
  }, [runtime?.machine.id, agentID])

  const project = runtime?.projects.find((candidate) => candidate.id === projectID)
  const agent = agents.find((candidate) => candidate.id === agentID)
  const model = models.find((candidate) => `${candidate.providerID}|${candidate.modelID}|${candidate.variant || ""}` === modelKey)
  const canStart = Boolean(runtime && project && agent && prompt.trim()) && !starting && !modelsLoading

  async function start() {
    if (!runtime || !project || !agent || !canStart) return
    setStarting(true)
    setError(null)
    try {
      let task = await taskClient.createTask(runtime.machine.config, {
        projectId: project.id,
        agentId: agent.id,
        prompt: prompt.trim(),
        model: model ? { providerID: model.providerID, modelID: model.modelID, variant: model.variant } : undefined
      })
      if (isolated && project.kind === "git") task = await taskClient.prepareWorktree(runtime.machine.config, task.id)
      task = await taskClient.launch(runtime.machine.config, task.id)
      onCreated(runtime, task)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="td3-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="td3-modal td3-new-task" role="dialog" aria-modal="true" aria-label="New Task" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>TaskDesk</small><h2>New Task</h2><p>Create durable agent work with an explicit machine, project, model and workspace.</p></div>
          <button type="button" onClick={onClose} aria-label="Close"><CloseIcon size={17} /></button>
        </header>
        <div className="td3-modal-body td3-form-grid">
          <label><span>Machine</span><select value={runtime?.machine.id || ""} onChange={(event) => setMachineID(event.target.value)}>{online.map((item) => <option key={item.machine.id} value={item.machine.id}>{item.snapshot?.machine.name || item.machine.name}</option>)}</select></label>
          <label><span>Project</span><select value={projectID} onChange={(event) => setProjectID(event.target.value)}>{runtime?.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Agent</span><select value={agentID} onChange={(event) => setAgentID(event.target.value)}>{agents.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>Model</span><select value={modelKey} onChange={(event) => setModelKey(event.target.value)} disabled={modelsLoading}>{modelsLoading ? <option value="">Loading models...</option> : null}{!modelsLoading && models.length === 0 ? <option value="">Agent default</option> : null}{models.map((item) => { const key = `${item.providerID}|${item.modelID}|${item.variant || ""}`; return <option key={key} value={key}>{item.modelName}{item.variant ? ` (${item.variant})` : ""}</option> })}</select></label>
          <label className="td3-form-wide"><span>Task</span><textarea rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the outcome you want the agent to deliver..." autoFocus /></label>
          <label className="td3-workspace-choice td3-form-wide">
            <input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} disabled={project?.kind !== "git"} />
            <span><strong>Use an isolated Git worktree</strong><small>{project?.kind === "git" ? "Recommended. The task gets its own branch and working directory." : "This project is not Git-backed, so it runs in the project directory."}</small></span>
          </label>
          {!isolated && project?.kind === "git" ? <div className="td3-inline-warning td3-form-wide">This task will edit the selected project checkout directly.</div> : null}
          {error ? <div className="td3-inline-error td3-form-wide">{error}</div> : null}
        </div>
        <footer><button type="button" className="td3-button" onClick={onClose}>Cancel</button><button type="button" className="td3-button primary" disabled={!canStart} onClick={() => void start()}>{starting ? <LoadingIcon size={15} /> : <PlusIcon size={15} />}{starting ? "Starting task..." : "Start Task"}</button></footer>
      </section>
    </div>
  )
}

function ContinueTaskModal({ record, onClose, onContinued }: { record: TaskRecord; onClose: () => void; onContinued: (task: MachineTask) => void }) {
  const [prompt, setPrompt] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (!prompt.trim() || working) return
    setWorking(true)
    setError(null)
    try {
      onContinued(await taskClient.continueTask(record.runtime.machine.config, record.task.id, prompt.trim()))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="td3-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="td3-modal td3-continue-modal" role="dialog" aria-modal="true" aria-label="Continue Task" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>New Run</small><h2>Continue Task</h2><p>{taskTitle(record.task)}</p></div><button type="button" onClick={onClose}><CloseIcon size={17} /></button></header>
        <div className="td3-modal-body"><label className="td3-stack-field"><span>What should the next Run do?</span><textarea rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Continue from the current workspace state and..." autoFocus /></label>{error ? <div className="td3-inline-error">{error}</div> : null}</div>
        <footer><button type="button" className="td3-button" onClick={onClose}>Cancel</button><button type="button" className="td3-button primary" disabled={!prompt.trim() || working} onClick={() => void submit()}>{working ? <LoadingIcon size={15} /> : null}{working ? "Starting..." : "Start new Run"}</button></footer>
      </section>
    </div>
  )
}

function QuestionAttentionCard({ item, onResolved, onOpenSession }: { item: Extract<AttentionItem, { type: "question" }>; onResolved: () => void; onOpenSession: () => void }) {
  const [answers, setAnswers] = useState<Record<number, string[]>>({})
  const [sending, setSending] = useState(false)
  const config = configForAgent(item.runtime, item.agent)
  async function reply() {
    setSending(true)
    try {
      const payload = item.request.questions.map((_question, index) => answers[index] || [])
      await api.replyQuestion(config, item.request.id, payload, item.task?.workspace.path)
      onResolved()
    } finally {
      setSending(false)
    }
  }
  return (
    <article className="td3-attention-card">
      <header><span className="td3-attention-icon">?</span><div><strong>Question</strong><small>{item.task ? taskTitle(item.task) : item.agent.label}</small></div></header>
      {item.request.questions.map((question, index) => <div className="td3-question" key={`${item.request.id}-${index}`}><p>{question.question}</p><div>{question.options.map((option) => { const selected = answers[index]?.includes(option.label) || false; return <button type="button" key={option.label} className={selected ? "selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [index]: question.multiple ? (selected ? (current[index] || []).filter((value) => value !== option.label) : [...(current[index] || []), option.label]) : [option.label] }))}>{option.label}</button> })}</div></div>)}
      <footer><button type="button" className="td3-link-button" onClick={onOpenSession}>Open session</button><button type="button" className="td3-button primary" disabled={sending} onClick={() => void reply()}>{sending ? "Sending..." : "Answer"}</button></footer>
    </article>
  )
}

export function TaskDeskV3({ machines, activeMachineID, onActiveMachineID, onPersistMachines, onManageMachines, legacyView }: Props) {
  const [view, setView] = useState<TaskDeskView>("tasks")
  const [runtimes, setRuntimes] = useState<RuntimeMachine[]>([])
  const [filter, setFilter] = useState<TaskFilter>("all")
  const [query, setQuery] = useState("")
  const [machineScope, setMachineScope] = useState(activeMachineID || "all")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")
  const [detail, setDetail] = useState<TaskDetail>(() => emptyDetail())
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [continueOpen, setContinueOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const refreshInFlight = useRef(false)
  const detailInFlight = useRef(false)
  const detailGeneration = useRef(0)

  useEffect(() => {
    if (activeMachineID && machines.some((machine) => machine.id === activeMachineID)) setMachineScope(activeMachineID)
  }, [activeMachineID])

  const refresh = useCallback(async (_silent = false) => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const next = await Promise.all(machines.map(async (machine): Promise<RuntimeMachine> => {
        try {
          const snapshot = await discoverMachine(machine.config)
          if (!snapshot) return { key: machine.id, machine, snapshot: null, projects: [], tasks: [], agents: [], state: "offline", error: "Not a Harness machine daemon" }
          const [projects, tasks] = await Promise.all([
            taskClient.listProjects(machine.config).catch(() => []),
            taskClient.listTasks(machine.config).catch(() => [])
          ])
          return { key: machine.id, machine, snapshot, projects, tasks: sortTasksByActivity(tasks), agents: selectableMachineAgents(snapshot), state: "online" }
        } catch (reason) {
          return { key: machine.id, machine, snapshot: null, projects: [], tasks: [], agents: [], state: "offline", error: reason instanceof Error ? reason.message : String(reason) }
        }
      }))
      setRuntimes(next)

      const nextAttention = (await Promise.all(next.filter((runtime) => runtime.state === "online").flatMap((runtime) => runtime.agents.map(async (agent) => {
        const config = configForAgent(runtime, agent)
        const [questions, permissions] = await Promise.all([
          api.loadQuestions(config).catch(() => []),
          api.loadPermissions(config).catch(() => [])
        ])
        return [
          ...permissions.map((request): AttentionItem => ({ key: `${runtime.key}|${agent.id}|permission|${request.id}`, type: "permission", runtime, agent, request, task: taskForSession(runtime, request.sessionID) })),
          ...questions.map((request): AttentionItem => ({ key: `${runtime.key}|${agent.id}|question|${request.id}`, type: "question", runtime, agent, request, task: taskForSession(runtime, request.sessionID) }))
        ]
      })))).flat()
      setAttention(nextAttention)

      const records = next.flatMap((runtime) => runtime.tasks.map((task) => ({ key: `${runtime.key}|${task.id}`, runtime, task })))
      setSelectedKey((current) => current && records.some((record) => record.key === current) ? current : records[0]?.key || null)
    } finally {
      refreshInFlight.current = false
    }
  }, [machines])

  useEffect(() => {
    void refresh(false)
    const timer = window.setInterval(() => void refresh(true), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const records = useMemo(() => runtimes.flatMap((runtime) => runtime.tasks.map((task) => ({ key: `${runtime.key}|${task.id}`, runtime, task }))), [runtimes])
  const selected = records.find((record) => record.key === selectedKey) || null

  const loadDetail = useCallback(async (record: TaskRecord, silent = false) => {
    if (detailInFlight.current && silent) return
    detailInFlight.current = true
    const generation = ++detailGeneration.current
    if (!silent) setDetail(emptyDetail(record.key, true))
    const agent = record.runtime.agents.find((candidate) => candidate.id === record.task.agentId)
    const sessionID = runSessionID(record.task.run)
    try {
      const resultPromise = taskClient.inspectResult(record.runtime.machine.config, record.task.id).catch(() => null)
      if (!agent || !sessionID) {
        const result = await resultPromise
        if (generation === detailGeneration.current) setDetail({ ...emptyDetail(record.key), result })
        return
      }
      const config = configForAgent(record.runtime, agent)
      const directory = record.task.run?.directory || record.task.workspace.path
      const [messages, diff, todos, vcs, result] = await Promise.all([
        api.loadMessages(config, sessionID, directory).catch(() => []),
        api.loadDiff(config, sessionID, directory).catch(() => []),
        api.loadTodo(config, sessionID, directory).catch(() => []),
        api.loadVcs(config, directory).catch(() => null),
        resultPromise
      ])
      if (generation !== detailGeneration.current) return
      setDetail({ ownerKey: record.key, loading: false, messages, diff, todos, vcs, result, error: null })
    } catch (reason) {
      if (generation === detailGeneration.current) setDetail({ ...emptyDetail(record.key), error: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      detailInFlight.current = false
    }
  }, [])

  useEffect(() => {
    detailGeneration.current += 1
    detailInFlight.current = false
    if (!selected) {
      setDetail(emptyDetail())
      return
    }
    setDetail(emptyDetail(selected.key, true))
    void loadDetail(selected, false)
    const timer = window.setInterval(() => void loadDetail(selected, true), DETAIL_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selected?.key, selected?.task.updatedAt, loadDetail])

  const scopedRecords = useMemo(() => records.filter((record) => machineScope === "all" || record.runtime.machine.id === machineScope), [records, machineScope])
  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scopedRecords.filter((record) => {
      if (!filterMatches(record.task.status, filter)) return false
      if (!needle) return true
      return [taskTitle(record.task), record.task.prompt, record.task.project?.name, agentLabel(record.runtime.agents, record.task.agentId), modelLabel(record.task), record.runtime.snapshot?.machine.name, record.runtime.machine.name].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [scopedRecords, filter, query])

  const counts = useMemo(() => ({
    tasks: records.length,
    running: records.filter((record) => ["running", "preparing", "queued"].includes(normalizeTaskStatus(record.task.status))).length,
    waiting: records.filter((record) => normalizeTaskStatus(record.task.status) === "waiting").length,
    completed: records.filter((record) => normalizeTaskStatus(record.task.status) === "completed").length,
    failed: records.filter((record) => normalizeTaskStatus(record.task.status) === "failed").length,
    machines: runtimes.filter((runtime) => runtime.state === "online").length,
    agents: runtimes.reduce((sum, runtime) => sum + runtime.agents.length, 0)
  }), [records, runtimes])

  const selectedRuntime = runtimes.find((runtime) => runtime.machine.id === machineScope) || runtimes.find((runtime) => runtime.machine.id === activeMachineID) || runtimes[0]
  const selectedAgent = selected?.runtime.agents.find((agent) => agent.id === selected.task.agentId)
  const selectedSessionID = selected ? runSessionID(selected.task.run) : null
  const detailReady = selected && detail.ownerKey === selected.key && !detail.loading
  const summary = detailReady ? latestAssistantText(detail.messages) : ""

  async function refreshAndReselect(taskID?: string, machineID?: string) {
    await refresh(true)
    if (taskID && machineID) setSelectedKey(`${machineID}|${taskID}`)
  }

  async function finishSelected() {
    if (!selected || actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      const response = await taskClient.finish(selected.runtime.machine.config, selected.task.id)
      await refreshAndReselect(response.task.id, selected.runtime.machine.id)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setActionBusy(false)
    }
  }

  async function cleanupSelected() {
    if (!selected || actionBusy) return
    if (!window.confirm("Release this task's isolated worktree? Uncommitted changes are protected and will make the daemon refuse cleanup.")) return
    setActionBusy(true)
    setActionError(null)
    try {
      const response = await taskClient.cleanupWorkspace(selected.runtime.machine.config, selected.task.id)
      await refreshAndReselect(response.task.id, selected.runtime.machine.id)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setActionBusy(false)
    }
  }

  if (view === "sessions") {
    return (
      <div className="td3-session-mode">
        <button type="button" className="td3-return-button" onClick={() => setView("tasks")}>← Tasks</button>
        <UniversalWorkspace
          profiles={machines}
          activeProfileID={activeMachineID}
          onPersistProfiles={(nextMachines, nextActiveID) => {
            onPersistMachines(nextMachines as WorkspaceMachine[])
            onActiveMachineID(nextActiveID)
          }}
          legacyView={legacyView}
        />
      </div>
    )
  }

  if (view === "classic") return <div className="td3-classic-mode"><button type="button" className="td3-return-button" onClick={() => setView("tasks")}>← TaskDesk</button>{legacyView}</div>

  const nav = (
    <aside className="td3-sidebar">
      <div className="td3-brand"><span>TD</span><div><strong>TaskDesk v3</strong><small>Harness Remote</small></div></div>
      <nav>
        <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><span>⌂</span>Overview</button>
        <button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><span>☷</span>Tasks<b>{counts.tasks}</b></button>
        <button onClick={() => setView("sessions")}><ChatIcon size={16} />Sessions</button>
        <button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><FolderIcon size={16} />Projects</button>
        <button className={view === "needs" ? "active" : ""} onClick={() => setView("needs")}><span>!</span>Needs You{attention.length ? <b className="attention">{attention.length}</b> : null}</button>
        <button className={view === "agents" ? "active" : ""} onClick={() => setView("agents")}><span>◇</span>Agents</button>
        <button className={view === "machines" ? "active" : ""} onClick={() => setView("machines")}><ServerIcon size={16} />Machines</button>
      </nav>
      <div className="td3-sidebar-bottom"><button onClick={() => setView("classic")}>Classic 2.x</button><button onClick={onManageMachines}>Manage machines</button></div>
    </aside>
  )

  const topbar = (
    <header className="td3-topbar">
      <div className="td3-machine-selector"><ServerIcon size={16} /><select value={machineScope} onChange={(event) => { const value = event.target.value; setMachineScope(value); if (value !== "all") onActiveMachineID(value) }}><option value="all">All machines</option>{runtimes.map((runtime) => <option key={runtime.machine.id} value={runtime.machine.id}>{runtime.snapshot?.machine.name || runtime.machine.name}</option>)}</select><span className={`td3-online-dot ${selectedRuntime?.state === "online" ? "online" : "offline"}`} /><small>{selectedRuntime?.state === "online" ? "Online" : "Offline"}</small></div>
      <div className="td3-agent-strip">{selectedRuntime?.agents.slice(0, 5).map((agent) => <HarnessBadge key={agent.id} agent={agent} />)}</div>
      <div className="td3-global-search"><SearchIcon size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, projects, agents..." /></div>
      <button type="button" className="td3-button primary" onClick={() => setNewTaskOpen(true)} disabled={!runtimes.some((runtime) => runtime.state === "online")}><PlusIcon size={15} />New Task</button>
      <button type="button" className="td3-button" onClick={() => setView("sessions")}><PlusIcon size={15} />New Session</button>
    </header>
  )

  return (
    <div className="td3-shell">
      {nav}
      <div className="td3-workspace">
        {topbar}

        {view === "overview" ? (
          <main className="td3-overview">
            <section className="td3-page-heading"><div><small>Control plane</small><h1>Overview</h1><p>Durable Tasks, native Sessions and every coding harness in one place.</p></div><button type="button" className="td3-button" onClick={() => void refresh(true)}><RefreshIcon size={15} />Refresh</button></section>
            <section className="td3-kpis"><article><span>Running</span><strong>{counts.running}</strong><small>active task runs</small></article><article><span>Needs You</span><strong>{attention.length}</strong><small>questions and permissions</small></article><article><span>Machines</span><strong>{counts.machines}/{runtimes.length}</strong><small>online</small></article><article><span>Agents</span><strong>{counts.agents}</strong><small>available harnesses</small></article></section>
            <div className="td3-overview-grid">
              <section className="td3-panel"><header><div><h2>Recent Tasks</h2><p>Most recently active durable work.</p></div><button onClick={() => setView("tasks")}>View all</button></header>{records.slice(0, 6).map((record) => <button className="td3-recent-task" key={record.key} onClick={() => { setSelectedKey(record.key); setView("tasks") }}><span className={`td3-status-dot td3-status-${taskStatusTone(record.task.status)}`} /><div><strong>{taskTitle(record.task)}</strong><small>{record.task.project.name} · {agentLabel(record.runtime.agents, record.task.agentId)}</small></div><time>{formatRelative(record.task.updatedAt)}</time></button>)}</section>
              <section className="td3-panel"><header><div><h2>Needs You</h2><p>Agent questions and permission requests.</p></div><button onClick={() => setView("needs")}>View all</button></header>{attention.length === 0 ? <div className="td3-empty-mini">Nothing needs your attention.</div> : attention.slice(0, 5).map((item) => <button className="td3-attention-row" key={item.key} onClick={() => setView("needs")}><span>{item.type === "permission" ? "!" : "?"}</span><div><strong>{item.type === "permission" ? "Permission request" : "Question"}</strong><small>{item.task ? taskTitle(item.task) : item.agent.label}</small></div></button>)}</section>
            </div>
          </main>
        ) : null}

        {view === "tasks" ? (
          <main className="td3-tasks-layout">
            <section className="td3-task-list-pane">
              <div className="td3-page-heading compact"><div><small>Durable work</small><h1>Tasks</h1><p>Tasks survive individual sessions and can accumulate multiple Runs.</p></div><button type="button" className="td3-button" onClick={() => void refresh(true)}><RefreshIcon size={15} /></button></div>
              <div className="td3-filters">{(["all", "running", "waiting", "completed", "failed"] as TaskFilter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}<span>{item === "all" ? scopedRecords.length : scopedRecords.filter((record) => filterMatches(record.task.status, item)).length}</span></button>)}</div>
              <div className="td3-task-table-head"><span>Task</span><span>Project</span><span>Agent</span><span>Model</span><span>Workspace</span><span>Status</span><span>Activity</span></div>
              <div className="td3-task-list">{filteredRecords.length === 0 ? <div className="td3-empty-state"><strong>No tasks match this view.</strong><span>Change filters or start a new Task.</span></div> : filteredRecords.map((record) => { const agent = record.runtime.agents.find((candidate) => candidate.id === record.task.agentId); const tone = taskStatusTone(record.task.status); return <button type="button" className={`td3-task-row${record.key === selectedKey ? " selected" : ""}`} key={record.key} onClick={() => { setSelectedKey(record.key); setDetailTab("overview"); setActionError(null) }}><span className="td3-task-title"><i className={`td3-status-dot td3-status-${tone}`} /><span><strong>{taskTitle(record.task)}</strong><small>{record.task.prompt.split(/\r?\n/).slice(1).join(" ").slice(0, 100) || record.runtime.snapshot?.machine.name || record.runtime.machine.name}</small></span></span><span>{record.task.project?.name || record.task.projectId}</span><span>{agent ? <HarnessBadge agent={agent} /> : record.task.agentId}</span><span>{modelLabel(record.task)}</span><span>{taskWorkspaceLabel(record.task)}</span><span><b className={`td3-status-pill td3-status-${tone}`}>{taskStatusLabel(record.task.status)}</b></span><time>{formatRelative(record.task.updatedAt)}</time></button> })}</div>
            </section>

            <aside className="td3-task-detail">
              {!selected ? <div className="td3-empty-state"><strong>Select a Task</strong><span>Task metadata, Run history, result and changed files appear here.</span></div> : (
                <>
                  <header className="td3-detail-header"><div><div className="td3-detail-title-line"><h2>{taskTitle(selected.task)}</h2><b className={`td3-status-pill td3-status-${taskStatusTone(selected.task.status)}`}>{taskStatusLabel(selected.task.status)}</b></div><p>{selected.task.prompt}</p></div></header>
                  <section className="td3-detail-meta"><span><small>Project</small><b>{selected.task.project.name}</b></span><span><small>Agent</small><b>{selectedAgent?.label || selected.task.agentId}</b></span><span><small>Model</small><b>{modelLabel(selected.task)}</b></span><span><small>Workspace</small><b>{taskWorkspaceLabel(selected.task)}</b></span><span><small>Machine</small><b>{selected.runtime.snapshot?.machine.name || selected.runtime.machine.name}</b></span><span><small>Run</small><b>{selected.task.run?.id || "Not started"}</b></span><span><small>Session</small><b>{selectedSessionID || "None"}</b></span><span><small>Branch</small><b>{selected.task.workspace.branch || detail.vcs?.branch || "Project checkout"}</b></span></section>
                  <nav className="td3-detail-tabs">{(["overview", "conversation", "diff", "runs"] as DetailTab[]).map((tab) => <button key={tab} className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}{tab === "diff" && detail.diff.length ? <span>{detail.diff.length}</span> : null}</button>)}</nav>
                  <div className="td3-detail-body">
                    {detail.loading && detail.ownerKey === selected.key ? <div className="td3-detail-loading"><LoadingIcon size={22} /><strong>Loading Task...</strong></div> : null}
                    {!detail.loading && detailTab === "overview" ? <><section className="td3-relationship"><h3>Task → Run → Session</h3><div><article><small>Task</small><strong>{taskTitle(selected.task)}</strong><span>Durable work item</span></article><i>→</i><article><small>Run</small><strong>{selected.task.run?.id || "Not started"}</strong><span>{selected.task.run?.startedAt ? `Started ${formatRelative(selected.task.run.startedAt)}` : "No Run yet"}</span></article><i>→</i><article><small>Session</small><strong>{selectedSessionID || "None"}</strong><span>{selectedAgent?.label || selected.task.agentId}</span></article></div></section><div className="td3-detail-cards"><section><header><h3>Result Summary</h3></header>{summary ? <div className="td3-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{summary}</ReactMarkdown></div> : <p className="td3-muted">No assistant result is available yet.</p>}{selected.task.error?.message ? <div className="td3-inline-error">{selected.task.error.message}</div> : null}</section><section><header><h3>Workspace result</h3></header><dl><dt>Changed files</dt><dd>{detail.diff.length || detail.result?.changeCount || 0}</dd><dt>Commits ahead</dt><dd>{detail.result?.commitsAhead ?? "-"}</dd><dt>Commits behind</dt><dd>{detail.result?.commitsBehind ?? "-"}</dd><dt>Dirty</dt><dd>{detail.result?.dirty ? "Yes" : "No"}</dd></dl>{detail.todos.length ? <div className="td3-todo-summary"><strong>Agent plan</strong>{detail.todos.slice(0, 5).map((todo) => <span key={todo.id}>{todo.status === "completed" ? "✓" : "•"} {todo.content}</span>)}</div> : null}</section></div></> : null}
                    {!detail.loading && detailTab === "conversation" ? <div className="td3-conversation">{detail.messages.length === 0 ? <div className="td3-empty-state"><span>No conversation is available for this Run.</span></div> : detail.messages.map((message) => { const text = extractText(message); return text ? <article key={message.info.id} className={message.info.role === "user" ? "user" : "assistant"}><header><strong>{message.info.role === "user" ? "You" : selectedAgent?.label || "Agent"}</strong></header><div className="td3-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown></div></article> : null })}</div> : null}
                    {!detail.loading && detailTab === "diff" ? <div className="td3-diff-list">{detail.diff.length === 0 ? <div className="td3-empty-state"><span>No changed files were reported by the current Session.</span></div> : detail.diff.map((file) => <details key={file.file}><summary><code>{file.file}</code><span><b>+{file.additions}</b><i>-{file.deletions}</i></span></summary>{file.patch ? <pre>{file.patch}</pre> : <p>No patch text available.</p>}</details>)}</div> : null}
                    {!detail.loading && detailTab === "runs" ? <div className="td3-runs"><header><h3>Run history</h3><p>Each continuation creates a new native Session while the Task remains the durable unit.</p></header>{taskRunHistory(selected.task).length === 0 ? <div className="td3-empty-state"><span>This Task has not started a Run yet.</span></div> : [...taskRunHistory(selected.task)].reverse().map((run, index) => <article key={run.id || index}><span className="td3-run-index">#{taskRunHistory(selected.task).length - index}</span><div><strong>{run.id || "Run"}</strong><small>{run.prompt || (index === taskRunHistory(selected.task).length - 1 ? selected.task.prompt : "Continuation")}</small></div><dl><dt>Session</dt><dd>{runSessionID(run) || "-"}</dd><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd><dt>Finished</dt><dd>{formatDate(run.finishedAt)}</dd></dl></article>)}</div> : null}
                    {detail.error ? <div className="td3-inline-error">{detail.error}</div> : null}
                  </div>
                  <footer className="td3-detail-actions">{selectedSessionID ? <button type="button" className="td3-button" onClick={() => setView("sessions")}>Open Session</button> : null}{["completed", "failed", "cancelled"].includes(normalizeTaskStatus(selected.task.status)) ? <button type="button" className="td3-button primary" onClick={() => setContinueOpen(true)}>Continue</button> : null}{!["running", "preparing", "queued"].includes(normalizeTaskStatus(selected.task.status)) ? <button type="button" className="td3-button" disabled={actionBusy} onClick={() => void finishSelected()}>Review / Finish</button> : null}{selected.task.workspace.mode === "worktree" && !["running", "preparing", "queued"].includes(normalizeTaskStatus(selected.task.status)) ? <button type="button" className="td3-button danger" disabled={actionBusy} onClick={() => void cleanupSelected()}>Cleanup</button> : null}{actionError ? <span className="td3-action-error">{actionError}</span> : null}</footer>
                </>
              )}
            </aside>
          </main>
        ) : null}

        {view === "projects" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Machine catalog</small><h1>Projects</h1><p>Projects are daemon-known roots used by Tasks. Arbitrary session folders stay separate.</p></div></section><div className="td3-card-grid">{runtimes.flatMap((runtime) => runtime.projects.map((project) => <article key={`${runtime.key}|${project.id}`}><FolderIcon size={20} /><div><h3>{project.name}</h3><code>{project.path}</code><span>{runtime.snapshot?.machine.name || runtime.machine.name} · {project.kind}</span></div><button onClick={() => { setMachineScope(runtime.machine.id); onActiveMachineID(runtime.machine.id); setView("tasks"); setNewTaskOpen(true) }}>New Task</button></article>))}</div></main> : null}

        {view === "agents" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Harnesses</small><h1>Agents</h1><p>Native coding harnesses discovered behind each machine daemon.</p></div></section><div className="td3-card-grid">{runtimes.flatMap((runtime) => runtime.agents.map((agent) => <article key={`${runtime.key}|${agent.id}`}><HarnessBadge agent={agent} /><div><h3>{agent.label}</h3><span>{runtime.snapshot?.machine.name || runtime.machine.name}</span><code>{agent.backend} · {agent.transport}</code></div></article>))}</div></main> : null}

        {view === "machines" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Fleet</small><h1>Machines</h1><p>Execution, credentials and source code stay local to each configured machine.</p></div><button className="td3-button primary" onClick={onManageMachines}>Manage machines</button></section><div className="td3-card-grid">{runtimes.map((runtime) => <article key={runtime.key}><ServerIcon size={22} /><div><h3>{runtime.snapshot?.machine.name || runtime.machine.name}</h3><code>{runtime.machine.config.host}:{runtime.machine.config.port}</code><span>{runtime.agents.length} agents · {runtime.tasks.length} tasks</span>{runtime.error ? <small className="td3-card-error">{runtime.error}</small> : null}</div><b className={`td3-machine-state ${runtime.state}`}>{runtime.state}</b></article>)}</div></main> : null}

        {view === "needs" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Attention inbox</small><h1>Needs You</h1><p>Questions and permission requests from native harness Sessions.</p></div></section><div className="td3-attention-list">{attention.length === 0 ? <div className="td3-empty-state"><strong>Nothing needs you right now.</strong></div> : attention.map((item) => item.type === "permission" ? <article className="td3-attention-card" key={item.key}><header><span className="td3-attention-icon warning">!</span><div><strong>Permission request</strong><small>{item.task ? taskTitle(item.task) : item.agent.label}</small></div></header><p>{item.request.permission}</p>{item.request.patterns?.length ? <code>{item.request.patterns.join(", ")}</code> : null}<footer><button className="td3-button danger" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "reject", item.task?.workspace.path).then(() => refresh(true))}>Reject</button><button className="td3-button" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "once", item.task?.workspace.path).then(() => refresh(true))}>Once</button><button className="td3-button primary" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "always", item.task?.workspace.path).then(() => refresh(true))}>Always</button></footer></article> : <QuestionAttentionCard key={item.key} item={item} onResolved={() => void refresh(true)} onOpenSession={() => setView("sessions")} />)}</div></main> : null}
      </div>

      {newTaskOpen ? <NewTaskModal runtimes={runtimes} initialMachineID={machineScope === "all" ? activeMachineID : machineScope} onClose={() => setNewTaskOpen(false)} onCreated={(runtime, task) => { setMachineScope(runtime.machine.id); onActiveMachineID(runtime.machine.id); setSelectedKey(`${runtime.key}|${task.id}`); void refreshAndReselect(task.id, runtime.machine.id) }} /> : null}
      {continueOpen && selected ? <ContinueTaskModal record={selected} onClose={() => setContinueOpen(false)} onContinued={(task) => void refreshAndReselect(task.id, selected.runtime.machine.id)} /> : null}
    </div>
  )
}
