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
  taskTitle
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
import "../taskdesk-v3-unified.css"

const REFRESH_MS = 10_000
const DETAIL_REFRESH_MS = 5_000
const REMARK_PLUGINS = [remarkGfm]

const HARNESS_ICON_FILES: Record<string, string> = {
  codex: "codex.svg",
  claude: "claude.svg",
  opencode: "opencode.svg",
  omp: "omp.svg",
  pi: "pi.svg"
}

type ProductTask = MachineTask & { finishedAt?: string | null }
type TaskDeskView = "overview" | "tasks" | "sessions" | "projects" | "needs" | "agents" | "machines" | "classic"
type TaskFilter = "all" | "active" | "review" | "finished" | "failed"
type DetailTab = "review" | "conversation" | "diff" | "runs"
type ProductTaskState = "draft" | "active" | "review" | "finished" | "failed" | "cancelled"
type SessionFocusRequest = { sessionID: string; requestID: number }

type RuntimeMachine = {
  key: string
  machine: WorkspaceMachine
  snapshot: MachineSnapshot | null
  projects: MachineProject[]
  tasks: ProductTask[]
  agents: MachineAgentHost[]
  state: "online" | "offline" | "loading"
  error?: string
}

type TaskRecord = {
  key: string
  runtime: RuntimeMachine
  task: ProductTask
}

type AttentionItem =
  | { key: string; type: "permission"; runtime: RuntimeMachine; agent: MachineAgentHost; request: PermissionRequest; task?: ProductTask }
  | { key: string; type: "question"; runtime: RuntimeMachine; agent: MachineAgentHost; request: QuestionRequest; task?: ProductTask }

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

function formatRelative(value?: string | null): string {
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

function taskWorkspaceLabel(task: ProductTask): string {
  return task.workspace?.mode === "worktree" ? "Isolated worktree" : "Project directory"
}

function productTaskState(task: ProductTask): ProductTaskState {
  if (task.finishedAt) return "finished"
  const status = normalizeTaskStatus(task.status)
  if (status === "running" || status === "preparing" || status === "queued") return "active"
  if (status === "completed") return "review"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  return "draft"
}

function productTaskLabel(task: ProductTask): string {
  const state = productTaskState(task)
  if (state === "active") return "Working"
  if (state === "review") return "Ready for review"
  if (state === "finished") return "Finished"
  if (state === "failed") return "Failed"
  if (state === "cancelled") return "Cancelled"
  return "Draft"
}

function filterMatches(task: ProductTask, filter: TaskFilter): boolean {
  if (filter === "all") return true
  const state = productTaskState(task)
  if (filter === "active") return state === "active" || state === "draft"
  if (filter === "review") return state === "review"
  if (filter === "finished") return state === "finished"
  return state === "failed" || state === "cancelled"
}

function taskRunHistory(task: ProductTask): MachineTaskRun[] {
  if (Array.isArray(task.runs) && task.runs.length) return task.runs
  return task.run ? [task.run] : []
}

function emptyDetail(ownerKey: string | null = null, loading = false): TaskDetail {
  return { ownerKey, loading, messages: [], diff: [], todos: [], vcs: null, result: null, error: null }
}

function taskForSession(runtime: RuntimeMachine, sessionID: string): ProductTask | undefined {
  return runtime.tasks.find((task) => taskRunHistory(task).some((run) => runSessionID(run) === sessionID))
}

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
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
  onCreated: (runtime: RuntimeMachine, task: ProductTask) => void
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
  }, [machineID, runtime?.machine.id])

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
      }) as ProductTask
      if (isolated && project.kind === "git") task = await taskClient.prepareWorktree(runtime.machine.config, task.id) as ProductTask
      task = await taskClient.launch(runtime.machine.config, task.id) as ProductTask
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
          <div><small>Durable work</small><h2>New Task</h2><p>Choose where the work lives, which harness owns it, and the model that will run it.</p></div>
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
            <span><strong>Use an isolated Git worktree</strong><small>{project?.kind === "git" ? "Recommended. The Task gets its own branch and working directory." : "This project is not Git-backed, so it runs in the project directory."}</small></span>
          </label>
          {!isolated && project?.kind === "git" ? <div className="td3-inline-warning td3-form-wide">This Task will edit the selected project checkout directly.</div> : null}
          {error ? <div className="td3-inline-error td3-form-wide">{error}</div> : null}
        </div>
        <footer><button type="button" className="td3-button" onClick={onClose}>Cancel</button><button type="button" className="td3-button primary" disabled={!canStart} onClick={() => void start()}>{starting ? <LoadingIcon size={15} /> : <PlusIcon size={15} />}{starting ? "Starting Task..." : "Start Task"}</button></footer>
      </section>
    </div>
  )
}

function ContinueTaskModal({ record, onClose, onContinued }: { record: TaskRecord; onClose: () => void; onContinued: (task: ProductTask) => void }) {
  const [prompt, setPrompt] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!prompt.trim() || working) return
    setWorking(true)
    setError(null)
    try {
      onContinued(await taskClient.continueTask(record.runtime.machine.config, record.task.id, prompt.trim()) as ProductTask)
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
        <header><div><small>New Run</small><h2>Continue Task</h2><p>{taskTitle(record.task)}</p></div><button type="button" onClick={onClose} aria-label="Close"><CloseIcon size={17} /></button></header>
        <div className="td3-modal-body"><label className="td3-stack-field"><span>What should the next Run do?</span><textarea rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Continue from the current workspace state and..." autoFocus /></label>{error ? <div className="td3-inline-error">{error}</div> : null}</div>
        <footer><button type="button" className="td3-button" onClick={onClose}>Cancel</button><button type="button" className="td3-button primary" disabled={!prompt.trim() || working} onClick={() => void submit()}>{working ? <LoadingIcon size={15} /> : null}{working ? "Starting..." : "Start new Run"}</button></footer>
      </section>
    </div>
  )
}

function QuestionAttentionCard({ item, onResolved, onOpenSession }: { item: Extract<AttentionItem, { type: "question" }>; onResolved: () => void; onOpenSession: (runtime: RuntimeMachine, sessionID: string) => void }) {
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
      <footer><button type="button" className="td3-link-button" onClick={() => onOpenSession(item.runtime, item.request.sessionID)}>Open Session</button><button type="button" className="td3-button primary" disabled={sending} onClick={() => void reply()}>{sending ? "Sending..." : "Answer"}</button></footer>
    </article>
  )
}

export function TaskDeskV3Unified({ machines, activeMachineID, onActiveMachineID, onPersistMachines, onManageMachines, legacyView }: Props) {
  const [view, setView] = useState<TaskDeskView>("tasks")
  const [runtimes, setRuntimes] = useState<RuntimeMachine[]>([])
  const [filter, setFilter] = useState<TaskFilter>("all")
  const [query, setQuery] = useState("")
  const [machineScope, setMachineScope] = useState(activeMachineID || "all")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>("review")
  const [detail, setDetail] = useState<TaskDetail>(() => emptyDetail())
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [continueOpen, setContinueOpen] = useState(false)
  const [sessionFocusRequest, setSessionFocusRequest] = useState<SessionFocusRequest | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const refreshInFlight = useRef(false)
  const detailInFlight = useRef(false)
  const detailGeneration = useRef(0)

  useEffect(() => {
    if (activeMachineID && machines.some((machine) => machine.id === activeMachineID)) setMachineScope(activeMachineID)
  }, [activeMachineID, machines])

  const refresh = useCallback(async () => {
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
          return { key: machine.id, machine, snapshot, projects, tasks: sortTasksByActivity(tasks) as ProductTask[], agents: selectableMachineAgents(snapshot), state: "online" }
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
      setSelectedKey((current) => current && records.some((record) => record.key === current) ? current : null)
    } finally {
      refreshInFlight.current = false
    }
  }, [machines])

  useEffect(() => {
    void refresh()
    if (view === "sessions" || view === "classic") return
    const timer = window.setInterval(() => {
      if (pageIsVisible()) void refresh()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh, view])

  const records = useMemo(() => runtimes.flatMap((runtime) => runtime.tasks.map((task) => ({ key: `${runtime.key}|${task.id}`, runtime, task }))), [runtimes])
  const selected = records.find((record) => record.key === selectedKey) || null

  const loadDetail = useCallback(async (record: TaskRecord, tab: DetailTab, silent = false) => {
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
      const needsMessages = tab === "review" || tab === "conversation"
      const needsDiff = tab === "review" || tab === "diff"
      const needsTodos = tab === "review"
      const needsVcs = tab === "review"
      const [messages, diff, todos, vcs, result] = await Promise.all([
        needsMessages ? api.loadMessages(config, sessionID, directory).catch(() => []) : Promise.resolve([] as MessageEnvelope[]),
        needsDiff ? api.loadDiff(config, sessionID, directory).catch(() => []) : Promise.resolve([] as DiffFile[]),
        needsTodos ? api.loadTodo(config, sessionID, directory).catch(() => []) : Promise.resolve([] as TodoItem[]),
        needsVcs ? api.loadVcs(config, directory).catch(() => null) : Promise.resolve(null as VcsStatus | null),
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
    if (view !== "tasks" || !selected || !detailOpen) {
      setDetail(emptyDetail())
      return
    }
    setDetail(emptyDetail(selected.key, true))
    void loadDetail(selected, detailTab, false)
    const timer = window.setInterval(() => {
      if (pageIsVisible()) void loadDetail(selected, detailTab, true)
    }, DETAIL_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [selected?.key, selected?.task.updatedAt, detailOpen, detailTab, view, loadDetail])

  const scopedRecords = useMemo(() => records.filter((record) => machineScope === "all" || record.runtime.machine.id === machineScope), [records, machineScope])
  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scopedRecords.filter((record) => {
      if (!filterMatches(record.task, filter)) return false
      if (!needle) return true
      return [taskTitle(record.task), record.task.prompt, record.task.project?.name, agentLabel(record.runtime.agents, record.task.agentId), modelLabel(record.task), record.runtime.snapshot?.machine.name, record.runtime.machine.name].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [scopedRecords, query, filter])

  const counts = useMemo(() => ({
    tasks: records.length,
    active: records.filter((record) => productTaskState(record.task) === "active").length,
    review: records.filter((record) => productTaskState(record.task) === "review").length,
    finished: records.filter((record) => productTaskState(record.task) === "finished").length,
    machines: runtimes.filter((runtime) => runtime.state === "online").length,
    agents: runtimes.reduce((sum, runtime) => sum + runtime.agents.length, 0)
  }), [records, runtimes])

  const selectedRuntime = machineScope === "all" ? runtimes.find((runtime) => runtime.machine.id === activeMachineID) || runtimes[0] : runtimes.find((runtime) => runtime.machine.id === machineScope)
  const selectedAgent = selected?.runtime.agents.find((agent) => agent.id === selected.task.agentId)
  const selectedSessionID = selected ? runSessionID(selected.task.run) : null
  const detailReady = Boolean(selected && detail.ownerKey === selected.key && !detail.loading)
  const summary = detailReady ? latestAssistantText(detail.messages) : ""
  const sessionProfiles = machineScope === "all" ? machines : machines.filter((machine) => machine.id === machineScope)

  async function refreshAndReselect(taskID?: string, machineID?: string, openDetail = true) {
    await refresh()
    if (taskID && machineID) {
      setSelectedKey(`${machineID}|${taskID}`)
      if (openDetail) setDetailOpen(true)
    }
  }

  function openTask(record: TaskRecord, tab: DetailTab = "review") {
    setSelectedKey(record.key)
    setDetailTab(tab)
    setDetailOpen(true)
    setActionError(null)
  }

  function openNativeSession(runtime: RuntimeMachine, sessionID: string) {
    setMachineScope(runtime.machine.id)
    onActiveMachineID(runtime.machine.id)
    setSessionFocusRequest((current) => ({ sessionID, requestID: (current?.requestID ?? 0) + 1 }))
    setView("sessions")
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
    if (!window.confirm("Release this Task's isolated worktree? Uncommitted changes are protected and will make the daemon refuse cleanup.")) return
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

  const nav = (
    <aside className="td3-sidebar">
      <div className="td3-brand"><span>TD</span><div><strong>TaskDesk v3</strong><small>Harness Remote</small></div></div>
      <nav>
        <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><span>⌂</span>Overview</button>
        <button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><span>☷</span>Tasks<b>{counts.tasks}</b></button>
        <button className={view === "sessions" ? "active" : ""} onClick={() => setView("sessions")}><ChatIcon size={16} />Sessions</button>
        <button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><FolderIcon size={16} />Projects</button>
        <button className={view === "needs" ? "active" : ""} onClick={() => setView("needs")}><span>!</span>Needs You{attention.length ? <b className="attention">{attention.length}</b> : null}</button>
        <button className={view === "agents" ? "active" : ""} onClick={() => setView("agents")}><span>◇</span>Agents</button>
        <button className={view === "machines" ? "active" : ""} onClick={() => setView("machines")}><ServerIcon size={16} />Machines</button>
      </nav>
      <div className="td3-sidebar-bottom"><button className={view === "classic" ? "active" : ""} onClick={() => setView("classic")}>Classic 2.x</button><button onClick={onManageMachines}>Manage machines</button></div>
    </aside>
  )

  const topbar = (
    <header className="td3-topbar td3-topbar-unified">
      <div className="td3-machine-selector"><ServerIcon size={16} /><select value={machineScope} onChange={(event) => { const value = event.target.value; setMachineScope(value); if (value !== "all") onActiveMachineID(value) }}><option value="all">All machines</option>{runtimes.map((runtime) => <option key={runtime.machine.id} value={runtime.machine.id}>{runtime.snapshot?.machine.name || runtime.machine.name}</option>)}</select><span className={`td3-online-dot ${selectedRuntime?.state === "online" ? "online" : "offline"}`} /><small>{machineScope === "all" ? `${counts.machines}/${runtimes.length} online` : selectedRuntime?.state === "online" ? "Online" : "Offline"}</small></div>
      <div className="td3-agent-strip">{selectedRuntime?.agents.slice(0, 5).map((agent) => <HarnessBadge key={agent.id} agent={agent} />)}</div>
      {view === "sessions" ? <div className="td3-view-context"><ChatIcon size={16} /><div><strong>Sessions</strong><small>Native harness conversations</small></div></div> : <div className="td3-global-search"><SearchIcon size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Tasks, projects, agents..." /></div>}
      {view !== "sessions" && view !== "classic" ? <button type="button" className="td3-button primary" onClick={() => setNewTaskOpen(true)} disabled={!runtimes.some((runtime) => runtime.state === "online")}><PlusIcon size={15} />New Task</button> : <button type="button" className="td3-button" onClick={() => setView("tasks")}>Tasks</button>}
    </header>
  )

  return (
    <div className="td3-shell td3-shell-unified">
      {nav}
      <div className="td3-workspace">
        {topbar}

        {view === "overview" ? (
          <main className="td3-overview">
            <section className="td3-page-heading"><div><small>Control plane</small><h1>Overview</h1><p>Durable Tasks, native Sessions and every coding harness in one place.</p></div><button type="button" className="td3-button" onClick={() => void refresh()}><RefreshIcon size={15} />Refresh</button></section>
            <section className="td3-kpis"><article><span>Working</span><strong>{counts.active}</strong><small>active Task runs</small></article><article><span>Ready for review</span><strong>{counts.review}</strong><small>completed Runs awaiting you</small></article><article><span>Needs You</span><strong>{attention.length}</strong><small>questions and permissions</small></article><article><span>Machines</span><strong>{counts.machines}/{runtimes.length}</strong><small>online</small></article></section>
            <div className="td3-overview-grid">
              <section className="td3-panel"><header><div><h2>Recent Tasks</h2><p>Most recently active durable work.</p></div><button onClick={() => setView("tasks")}>View all</button></header>{records.slice(0, 6).map((record) => <button className="td3-recent-task" key={record.key} onClick={() => { setView("tasks"); openTask(record) }}><span className={`td3-status-dot td3-status-${productTaskState(record.task)}`} /><div><strong>{taskTitle(record.task)}</strong><small>{record.task.project.name} · {agentLabel(record.runtime.agents, record.task.agentId)}</small></div><time>{formatRelative(record.task.updatedAt)}</time></button>)}</section>
              <section className="td3-panel"><header><div><h2>Needs You</h2><p>Agent questions and permission requests.</p></div><button onClick={() => setView("needs")}>View all</button></header>{attention.length === 0 ? <div className="td3-empty-mini">Nothing needs your attention.</div> : attention.slice(0, 5).map((item) => <button className="td3-attention-row" key={item.key} onClick={() => setView("needs")}><span>{item.type === "permission" ? "!" : "?"}</span><div><strong>{item.type === "permission" ? "Permission request" : "Question"}</strong><small>{item.task ? taskTitle(item.task) : item.agent.label}</small></div></button>)}</section>
            </div>
          </main>
        ) : null}

        {view === "tasks" ? (
          <main className={`td3-tasks-layout td3-tasks-layout-unified${detailOpen ? " detail-open" : ""}`}>
            <section className="td3-task-list-pane">
              <div className="td3-page-heading compact"><div><small>Durable work</small><h1>Tasks</h1><p>One Task can contain multiple Runs and native Sessions.</p></div><button type="button" className="td3-button" onClick={() => void refresh()}><RefreshIcon size={15} /></button></div>
              <div className="td3-filters">{(["all", "active", "review", "finished", "failed"] as TaskFilter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "All" : item === "active" ? "Working" : item === "review" ? "Review" : item[0].toUpperCase() + item.slice(1)}<span>{item === "all" ? scopedRecords.length : scopedRecords.filter((record) => filterMatches(record.task, item)).length}</span></button>)}</div>
              <div className="td3-task-table-head"><span>Task</span><span>Project</span><span>Agent</span><span>Model</span><span>Workspace</span><span>Status</span><span>Activity</span></div>
              <div className="td3-task-list">{filteredRecords.length === 0 ? <div className="td3-empty-state"><strong>No Tasks match this view.</strong><span>Change filters or start a new Task.</span></div> : filteredRecords.map((record) => { const agent = record.runtime.agents.find((candidate) => candidate.id === record.task.agentId); const state = productTaskState(record.task); return <button type="button" className={`td3-task-row${record.key === selectedKey && detailOpen ? " selected" : ""}`} key={record.key} onClick={() => openTask(record)}><span className="td3-task-title"><i className={`td3-status-dot td3-status-${state}`} /><span><strong>{taskTitle(record.task)}</strong><small>{record.task.prompt.split(/\r?\n/).slice(1).join(" ").slice(0, 100) || record.runtime.snapshot?.machine.name || record.runtime.machine.name}</small></span></span><span>{record.task.project?.name || record.task.projectId}</span><span>{agent ? <HarnessBadge agent={agent} /> : record.task.agentId}</span><span>{modelLabel(record.task)}</span><span>{taskWorkspaceLabel(record.task)}</span><span><b className={`td3-status-pill td3-status-${state}`}>{productTaskLabel(record.task)}</b></span><time>{formatRelative(record.task.updatedAt)}</time></button> })}</div>
            </section>

            {detailOpen ? <aside className="td3-task-detail td3-task-detail-open">
              {!selected ? <div className="td3-empty-state"><strong>Select a Task</strong><span>Review, conversation, diff and Run history appear here.</span></div> : (
                <>
                  <header className="td3-detail-header"><div><div className="td3-detail-title-line"><div><small className="td3-detail-eyebrow">Task review</small><h2>{taskTitle(selected.task)}</h2></div><div className="td3-detail-title-actions"><b className={`td3-status-pill td3-status-${productTaskState(selected.task)}`}>{productTaskLabel(selected.task)}</b><button type="button" className="td3-detail-close" onClick={() => setDetailOpen(false)} aria-label="Close Task detail"><CloseIcon size={16} /></button></div></div><p>{selected.task.prompt}</p></div></header>
                  <section className="td3-detail-meta"><span><small>Project</small><b>{selected.task.project.name}</b></span><span><small>Agent</small><b>{selectedAgent?.label || selected.task.agentId}</b></span><span><small>Model</small><b>{modelLabel(selected.task)}</b></span><span><small>Workspace</small><b>{taskWorkspaceLabel(selected.task)}</b></span><span><small>Machine</small><b>{selected.runtime.snapshot?.machine.name || selected.runtime.machine.name}</b></span><span><small>Run</small><b>{selected.task.run?.id || "Not started"}</b></span><span><small>Session</small><b>{selectedSessionID || "None"}</b></span><span><small>Branch</small><b>{selected.task.workspace.branch || detail.vcs?.branch || "Project checkout"}</b></span></section>
                  <nav className="td3-detail-tabs">{(["review", "conversation", "diff", "runs"] as DetailTab[]).map((tab) => <button key={tab} className={detailTab === tab ? "active" : ""} onClick={() => setDetailTab(tab)}>{tab === "review" ? "Review" : tab[0].toUpperCase() + tab.slice(1)}{tab === "diff" && detail.diff.length ? <span>{detail.diff.length}</span> : null}</button>)}</nav>
                  <div className="td3-detail-body">
                    {detail.loading && detail.ownerKey === selected.key ? <div className="td3-detail-loading"><LoadingIcon size={22} /><strong>Loading Task...</strong></div> : null}
                    {!detail.loading && detailTab === "review" ? <><section className="td3-review-hero"><div><small>Current outcome</small><h3>{productTaskState(selected.task) === "review" ? "Run complete. Review the result before finishing the Task." : productTaskState(selected.task) === "finished" ? "Task finished." : productTaskState(selected.task) === "active" ? "Agent is still working." : "Review the latest Task state."}</h3></div><div className="td3-review-metrics"><span><small>Files</small><b>{detail.diff.length || detail.result?.changeCount || 0}</b></span><span><small>Ahead</small><b>{detail.result?.commitsAhead ?? "-"}</b></span><span><small>Dirty</small><b>{detail.result?.dirty ? "Yes" : "No"}</b></span></div></section><section className="td3-relationship"><h3>Task → Run → Session</h3><div><article><small>Task</small><strong>{taskTitle(selected.task)}</strong><span>Durable work item</span></article><i>→</i><article><small>Run</small><strong>{selected.task.run?.id || "Not started"}</strong><span>{selected.task.run?.startedAt ? `Started ${formatRelative(selected.task.run.startedAt)}` : "No Run yet"}</span></article><i>→</i><article><small>Session</small><strong>{selectedSessionID || "None"}</strong><span>{selectedAgent?.label || selected.task.agentId}</span></article></div></section><div className="td3-detail-cards"><section><header><h3>Result Summary</h3></header>{summary ? <div className="td3-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{summary}</ReactMarkdown></div> : <p className="td3-muted">No assistant result is available yet.</p>}{selected.task.error?.message ? <div className="td3-inline-error">{selected.task.error.message}</div> : null}</section><section><header><h3>Workspace</h3></header><dl><dt>Changed files</dt><dd>{detail.diff.length || detail.result?.changeCount || 0}</dd><dt>Commits ahead</dt><dd>{detail.result?.commitsAhead ?? "-"}</dd><dt>Commits behind</dt><dd>{detail.result?.commitsBehind ?? "-"}</dd><dt>Merged to source</dt><dd>{detail.result?.mergedIntoSource === undefined ? "-" : detail.result.mergedIntoSource ? "Yes" : "No"}</dd></dl>{detail.todos.length ? <div className="td3-todo-summary"><strong>Agent plan</strong>{detail.todos.slice(0, 5).map((todo) => <span key={todo.id}>{todo.status === "completed" ? "✓" : "•"} {todo.content}</span>)}</div> : null}</section></div></> : null}
                    {!detail.loading && detailTab === "conversation" ? <div className="td3-conversation">{detail.messages.length === 0 ? <div className="td3-empty-state"><span>No conversation is available for this Run.</span></div> : detail.messages.map((message) => { const text = extractText(message); return text ? <article key={message.info.id} className={message.info.role === "user" ? "user" : "assistant"}><header><strong>{message.info.role === "user" ? "You" : selectedAgent?.label || "Agent"}</strong></header><div className="td3-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown></div></article> : null })}</div> : null}
                    {!detail.loading && detailTab === "diff" ? <div className="td3-diff-list">{detail.diff.length === 0 ? <div className="td3-empty-state"><span>No changed files were reported by the current Session.</span></div> : detail.diff.map((file) => <details key={file.file}><summary><code>{file.file}</code><span><b>+{file.additions}</b><i>-{file.deletions}</i></span></summary>{file.patch ? <pre>{file.patch}</pre> : <p>No patch text available.</p>}</details>)}</div> : null}
                    {!detail.loading && detailTab === "runs" ? <div className="td3-runs"><header><h3>Run history</h3><p>Each continuation creates a new native Session while the Task remains the durable unit.</p></header>{taskRunHistory(selected.task).length === 0 ? <div className="td3-empty-state"><span>This Task has not started a Run yet.</span></div> : [...taskRunHistory(selected.task)].reverse().map((run, index) => <article key={run.id || index}><span className="td3-run-index">#{taskRunHistory(selected.task).length - index}</span><div><strong>{run.id || "Run"}</strong><small>{run.prompt || "Task run"}</small></div><dl><dt>Session</dt><dd>{runSessionID(run) || "-"}</dd><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd><dt>Finished</dt><dd>{formatDate(run.finishedAt)}</dd></dl></article>)}</div> : null}
                    {detail.error ? <div className="td3-inline-error">{detail.error}</div> : null}
                  </div>
                  <footer className="td3-detail-actions"><div className="td3-detail-actions-primary">{selectedSessionID ? <button type="button" className="td3-button" onClick={() => openNativeSession(selected.runtime, selectedSessionID)}>Open Session</button> : null}{["review", "failed", "cancelled", "finished"].includes(productTaskState(selected.task)) ? <button type="button" className="td3-button" onClick={() => setContinueOpen(true)}>Continue</button> : null}{!selected.task.finishedAt && !["active", "draft"].includes(productTaskState(selected.task)) ? <button type="button" className="td3-button primary" disabled={actionBusy} onClick={() => void finishSelected()}>Finish Task</button> : null}</div>{selected.task.workspace.mode === "worktree" && productTaskState(selected.task) !== "active" ? <button type="button" className="td3-button danger" disabled={actionBusy} onClick={() => void cleanupSelected()}>Cleanup Workspace</button> : null}{actionError ? <span className="td3-action-error">{actionError}</span> : null}</footer>
                </>
              )}
            </aside> : null}
          </main>
        ) : null}

        {view === "sessions" ? <main className="td3-sessions-embedded"><UniversalWorkspace profiles={sessionProfiles} activeProfileID={activeMachineID} focusSessionRequest={sessionFocusRequest} onPersistProfiles={(nextMachines, nextActiveID) => { onPersistMachines(nextMachines as WorkspaceMachine[]); onActiveMachineID(nextActiveID) }} legacyView={legacyView} /></main> : null}

        {view === "projects" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Machine catalog</small><h1>Projects</h1><p>Projects are daemon-known roots used by Tasks. Ordinary Sessions can still use their native directories.</p></div></section><div className="td3-card-grid">{runtimes.flatMap((runtime) => runtime.projects.map((project) => <article key={`${runtime.key}|${project.id}`}><FolderIcon size={20} /><div><h3>{project.name}</h3><code>{project.path}</code><span>{runtime.snapshot?.machine.name || runtime.machine.name} · {project.kind}</span></div><button onClick={() => { setMachineScope(runtime.machine.id); onActiveMachineID(runtime.machine.id); setView("tasks"); setNewTaskOpen(true) }}>New Task</button></article>))}</div></main> : null}

        {view === "agents" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Harnesses</small><h1>Agents</h1><p>Native coding harnesses discovered behind each machine daemon.</p></div></section><div className="td3-card-grid">{runtimes.flatMap((runtime) => runtime.agents.map((agent) => <article key={`${runtime.key}|${agent.id}`}><HarnessBadge agent={agent} /><div><h3>{agent.label}</h3><span>{runtime.snapshot?.machine.name || runtime.machine.name}</span><code>{agent.backend} · {agent.transport}</code></div></article>))}</div></main> : null}

        {view === "machines" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Fleet</small><h1>Machines</h1><p>Execution, credentials and source code stay local to each configured machine.</p></div><button className="td3-button primary" onClick={onManageMachines}>Manage machines</button></section><div className="td3-card-grid">{runtimes.map((runtime) => <article key={runtime.key}><ServerIcon size={22} /><div><h3>{runtime.snapshot?.machine.name || runtime.machine.name}</h3><code>{runtime.machine.config.host}:{runtime.machine.config.port}</code><span>{runtime.agents.length} agents · {runtime.tasks.length} Tasks</span>{runtime.error ? <small className="td3-card-error">{runtime.error}</small> : null}</div><b className={`td3-machine-state ${runtime.state}`}>{runtime.state}</b></article>)}</div></main> : null}

        {view === "needs" ? <main className="td3-simple-page"><section className="td3-page-heading"><div><small>Attention inbox</small><h1>Needs You</h1><p>Questions and permission requests from native harness Sessions.</p></div></section><div className="td3-attention-list">{attention.length === 0 ? <div className="td3-empty-state"><strong>Nothing needs you right now.</strong></div> : attention.map((item) => item.type === "permission" ? <article className="td3-attention-card" key={item.key}><header><span className="td3-attention-icon warning">!</span><div><strong>Permission request</strong><small>{item.task ? taskTitle(item.task) : item.agent.label}</small></div></header><p>{item.request.permission}</p>{item.request.patterns?.length ? <code>{item.request.patterns.join(", ")}</code> : null}<footer><button type="button" className="td3-link-button" onClick={() => openNativeSession(item.runtime, item.request.sessionID)}>Open Session</button><button className="td3-button danger" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "reject", item.task?.workspace.path).then(() => refresh())}>Reject</button><button className="td3-button" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "once", item.task?.workspace.path).then(() => refresh())}>Once</button><button className="td3-button primary" onClick={() => void api.replyPermission(configForAgent(item.runtime, item.agent), item.request.id, "always", item.task?.workspace.path).then(() => refresh())}>Always</button></footer></article> : <QuestionAttentionCard key={item.key} item={item} onResolved={() => void refresh()} onOpenSession={openNativeSession} />)}</div></main> : null}

        {view === "classic" ? <main className="td3-classic-integrated"><div className="td3-classic-notice"><div><small>Legacy surface</small><strong>Classic 2.x</strong><span>Kept intact during TaskDesk validation.</span></div><button className="td3-button" onClick={() => setView("tasks")}>Back to Tasks</button></div><div className="td3-classic-integrated-host">{legacyView}</div></main> : null}
      </div>

      {newTaskOpen ? <NewTaskModal runtimes={runtimes} initialMachineID={machineScope === "all" ? activeMachineID : machineScope} onClose={() => setNewTaskOpen(false)} onCreated={(runtime, task) => { setMachineScope(runtime.machine.id); onActiveMachineID(runtime.machine.id); setView("tasks"); setSelectedKey(`${runtime.key}|${task.id}`); setDetailOpen(true); setDetailTab("review"); void refreshAndReselect(task.id, runtime.machine.id) }} /> : null}
      {continueOpen && selected ? <ContinueTaskModal record={selected} onClose={() => setContinueOpen(false)} onContinued={(task) => { setDetailTab("review"); void refreshAndReselect(task.id, selected.runtime.machine.id) }} /> : null}
    </div>
  )
}
