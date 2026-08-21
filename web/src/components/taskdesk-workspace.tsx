import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { discoverMachine, selectableMachineAgents } from "../machineClient"
import type { SavedServerProfile } from "../serverProfiles"
import {
  taskClient,
  type MachineProject,
  type MachineTask
} from "../taskClient"
import type { MachineAgentHost, MachineSnapshot, ModelOption } from "../types"
import type { WorkspaceMachine } from "../workspaceMachines"
import {
  ChatIcon,
  FolderIcon,
  LoadingIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon
} from "../Icons"
import { UniversalWorkspace } from "./universal-workspace"
import { WorkThreadDetail } from "./work-thread-detail"
import "../taskdesk-workthreads.css"

type Props = {
  machines: WorkspaceMachine[]
  activeMachineID: string
  onActiveMachineID: (id: string) => void
  onManageMachines: () => void
  legacyView: ReactNode
}

type Runtime = {
  machine: WorkspaceMachine
  snapshot: MachineSnapshot | null
  projects: MachineProject[]
  tasks: MachineTask[]
  agents: MachineAgentHost[]
  state: "loading" | "online" | "offline"
  error?: string
}

type ThreadRecord = {
  key: string
  runtime: Runtime
  task: MachineTask
}

type ProjectRecord = {
  key: string
  runtime: Runtime
  project: MachineProject
  count: number
}

type ProductMode = "workspace" | "sessions" | "classic"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function threadTitle(task: MachineTask): string {
  if (task.title?.trim()) return task.title.trim()
  const line = task.prompt.trim().split(/\r?\n/).find(Boolean)?.trim() || "Untitled Work Thread"
  return line.length > 86 ? `${line.slice(0, 83)}...` : line
}

function threadAgentID(task: MachineTask): string {
  return task.run?.agentId || task.agentId
}

function threadState(task: MachineTask): "working" | "ready" | "failed" | "idle" {
  if (task.status === "starting" || task.status === "running") return "working"
  if (task.status === "failed" || task.status === "cancelled") return "failed"
  if (task.status === "completed" || task.finishedAt) return "ready"
  return "idle"
}

function threadStateLabel(task: MachineTask): string {
  if (task.finishedAt) return "Done"
  const state = threadState(task)
  if (state === "working") return "Working"
  if (task.status === "cancelled") return "Stopped"
  if (state === "ready") return "Ready"
  if (state === "failed") return "Needs attention"
  return "Idle"
}

function formatRelative(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ""
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.round(delta / 86_400_000)}d`
}

function modelLabel(task: MachineTask): string {
  const model = task.run?.model ?? task.model
  if (!model) return "Default model"
  const variant = model.variant ? ` · ${model.variant}` : ""
  return `${model.modelID}${variant}`
}

function profileForMachine(machine: WorkspaceMachine): SavedServerProfile {
  return { id: machine.id, name: machine.name, config: machine.config }
}

function agentForThread(record: ThreadRecord): MachineAgentHost | undefined {
  return record.runtime.agents.find((agent) => agent.id === threadAgentID(record.task))
}

function NewWorkThreadModal({
  runtimes,
  initialMachineID,
  initialProjectKey,
  onClose,
  onCreated
}: {
  runtimes: Runtime[]
  initialMachineID: string
  initialProjectKey: string
  onClose: () => void
  onCreated: (runtime: Runtime, task: MachineTask) => void
}) {
  const online = runtimes.filter((runtime) => runtime.state === "online" && runtime.projects.length > 0 && runtime.agents.length > 0)
  const initialProject = initialProjectKey.includes(":") ? initialProjectKey.split(":").slice(1).join(":") : ""
  const initialRuntime = online.find((runtime) => runtime.machine.id === initialMachineID) || online[0]
  const [machineID, setMachineID] = useState(initialRuntime?.machine.id || "")
  const runtime = online.find((candidate) => candidate.machine.id === machineID) || initialRuntime
  const [projectID, setProjectID] = useState(
    runtime?.projects.some((project) => project.id === initialProject) ? initialProject : runtime?.projects[0]?.id || ""
  )
  const [agentID, setAgentID] = useState(runtime?.agents[0]?.id || "")
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelKey, setModelKey] = useState("")
  const [modelsLoading, setModelsLoading] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (!runtime) return
    if (!runtime.projects.some((project) => project.id === projectID)) setProjectID(runtime.projects[0]?.id || "")
    if (!runtime.agents.some((agent) => agent.id === agentID)) setAgentID(runtime.agents[0]?.id || "")
  }, [runtime?.machine.id])

  useEffect(() => {
    if (!runtime || !agentID) {
      setModels([])
      setModelKey("")
      return
    }
    const current = ++generation.current
    setModelsLoading(true)
    setError(null)
    void taskClient.listAgentModels(runtime.machine.config, agentID).then((catalog) => {
      if (generation.current !== current) return
      setModels(catalog.models)
      const selected = catalog.models.find((model) => model.isDefault) || catalog.models[0]
      setModelKey(selected ? `${selected.providerID}|${selected.modelID}|${selected.variant || ""}` : "")
    }).catch((reason) => {
      if (generation.current === current) {
        setModels([])
        setModelKey("")
        setError(errorText(reason))
      }
    }).finally(() => {
      if (generation.current === current) setModelsLoading(false)
    })
  }, [runtime?.machine.id, agentID])

  const project = runtime?.projects.find((candidate) => candidate.id === projectID)
  const agent = runtime?.agents.find((candidate) => candidate.id === agentID)
  const selectedModel = models.find((model) => `${model.providerID}|${model.modelID}|${model.variant || ""}` === modelKey)
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
        model: selectedModel ? {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
          variant: selectedModel.variant
        } : undefined
      })
      if (project.kind === "git") {
        task = await taskClient.prepareWorktree(runtime.machine.config, task.id)
        try {
          await taskClient.createCheckpoint(runtime.machine.config, task.id, {
            label: "Before work began",
            kind: "baseline"
          })
          task = await taskClient.getWorkThread(runtime.machine.config, task.id)
        } catch {
          // A checkpoint must never prevent the user from starting work. Older daemons also do not
          // expose the Work Thread checkpoint endpoint, so launch remains backward compatible.
        }
      }
      task = await taskClient.launch(runtime.machine.config, task.id)
      onCreated(runtime, task)
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setStarting(false)
    }
  }

  if (!runtime) {
    return (
      <div className="tdw-modal-backdrop" role="presentation" onMouseDown={onClose}>
        <section className="tdw-modal" role="dialog" aria-modal="true" aria-label="New Work Thread" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>New Work Thread</span><h2>No coding machine is ready</h2></div><button type="button" onClick={onClose}>×</button></header>
          <div className="tdw-modal-body"><p>Connect a machine with at least one project and one available coding agent.</p></div>
        </section>
      </div>
    )
  }

  return (
    <div className="tdw-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="tdw-modal" role="dialog" aria-modal="true" aria-label="New Work Thread" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>New Work Thread</span><h2>What do you want to build or change?</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="tdw-modal-body">
          <div className="tdw-form-row">
            <label><span>Machine</span><select value={runtime.machine.id} onChange={(event) => setMachineID(event.target.value)}>{online.map((item) => <option value={item.machine.id} key={item.machine.id}>{item.snapshot?.machine.name || item.machine.name}</option>)}</select></label>
            <label><span>Project</span><select value={projectID} onChange={(event) => setProjectID(event.target.value)}>{runtime.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          </div>
          <div className="tdw-form-row">
            <label><span>Coding agent</span><select value={agentID} onChange={(event) => setAgentID(event.target.value)}>{runtime.agents.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label><span>Model</span><select value={modelKey} disabled={modelsLoading || models.length === 0} onChange={(event) => setModelKey(event.target.value)}>{models.length === 0 ? <option value="">{modelsLoading ? "Loading models..." : "Default model"}</option> : models.map((model) => <option value={`${model.providerID}|${model.modelID}|${model.variant || ""}`} key={`${model.providerID}|${model.modelID}|${model.variant || ""}`}>{model.modelName || model.modelID}{model.variant ? ` · ${model.variant}` : ""}</option>)}</select></label>
          </div>
          <label className="tdw-prompt-field"><span>Start the conversation</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} autoFocus placeholder="Describe the change you want. You can keep refining it in this same conversation after the agent responds." /></label>
          <p className="tdw-safety-note">TaskDesk prepares an isolated coding workspace automatically when the project supports it.</p>
          {error ? <div className="tdw-inline-error" role="alert">{error}</div> : null}
        </div>
        <footer>
          <button type="button" className="tdw-button secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="tdw-button primary" disabled={!canStart} onClick={() => void start()}>{starting ? <><LoadingIcon size={15} /> Starting...</> : <><PlusIcon size={15} /> Start Work Thread</>}</button>
        </footer>
      </section>
    </div>
  )
}

export function TaskDeskWorkspace({ machines, activeMachineID, onActiveMachineID, onManageMachines, legacyView }: Props) {
  const [mode, setMode] = useState<ProductMode>("workspace")
  const [runtimes, setRuntimes] = useState<Runtime[]>(() => machines.map((machine) => ({ machine, snapshot: null, projects: [], tasks: [], agents: [], state: "loading" })))
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selectedProjectKey, setSelectedProjectKey] = useState("all")
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null)
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [search, setSearch] = useState("")
  const refreshGeneration = useRef(0)

  useEffect(() => {
    const generation = ++refreshGeneration.current
    let cancelled = false
    if (machines.length === 0) {
      setRuntimes([])
      setLoaded(true)
      return
    }
    setRefreshing(true)
    void Promise.all(machines.map(async (machine): Promise<Runtime> => {
      try {
        const snapshot = await discoverMachine(machine.config)
        if (!snapshot) return { machine, snapshot: null, projects: [], tasks: [], agents: [], state: "offline", error: "This endpoint is not a Harness machine daemon." }
        const [projects, tasks] = await Promise.all([
          taskClient.listProjects(machine.config),
          taskClient.listTasks(machine.config)
        ])
        return {
          machine,
          snapshot,
          projects,
          tasks: [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
          agents: selectableMachineAgents(snapshot),
          state: "online"
        }
      } catch (reason) {
        return { machine, snapshot: null, projects: [], tasks: [], agents: [], state: "offline", error: errorText(reason) }
      }
    })).then((next) => {
      if (!cancelled && refreshGeneration.current === generation) setRuntimes(next)
    }).finally(() => {
      if (!cancelled && refreshGeneration.current === generation) {
        setLoaded(true)
        setRefreshing(false)
      }
    })
    return () => { cancelled = true }
  }, [machines, revision])

  useEffect(() => {
    if (!loaded) return
    const timer = window.setInterval(() => setRevision((value) => value + 1), 10_000)
    return () => window.clearInterval(timer)
  }, [loaded])

  const threads = useMemo<ThreadRecord[]>(() => runtimes.flatMap((runtime) => runtime.tasks.map((task) => ({ key: `${runtime.machine.id}:${task.id}`, runtime, task }))).sort((a, b) => Date.parse(b.task.updatedAt) - Date.parse(a.task.updatedAt)), [runtimes])

  const projects = useMemo<ProjectRecord[]>(() => runtimes.flatMap((runtime) => runtime.projects.map((project) => ({
    key: `${runtime.machine.id}:${project.id}`,
    runtime,
    project,
    count: runtime.tasks.filter((task) => task.projectId === project.id).length
  }))).sort((a, b) => a.project.name.localeCompare(b.project.name)), [runtimes])

  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return threads.filter((record) => {
      const inProject = selectedProjectKey === "all" || `${record.runtime.machine.id}:${record.task.projectId}` === selectedProjectKey
      if (!inProject) return false
      if (!query) return true
      return `${threadTitle(record.task)} ${record.task.project?.name || ""} ${record.task.prompt}`.toLowerCase().includes(query)
    })
  }, [threads, selectedProjectKey, search])

  useEffect(() => {
    if (selectedThreadKey && threads.some((record) => record.key === selectedThreadKey)) return
    setSelectedThreadKey(visibleThreads[0]?.key || threads[0]?.key || null)
  }, [threads, visibleThreads, selectedThreadKey])

  const selected = threads.find((record) => record.key === selectedThreadKey) || null
  const profiles = useMemo(() => machines.map(profileForMachine), [machines])
  const activeProfileID = selected?.runtime.machine.id || activeMachineID || profiles[0]?.id || ""
  const onlineCount = runtimes.filter((runtime) => runtime.state === "online").length
  const workingCount = threads.filter((record) => threadState(record.task) === "working").length

  function selectProject(key: string) {
    setSelectedProjectKey(key)
    const first = threads.find((record) => key === "all" || `${record.runtime.machine.id}:${record.task.projectId}` === key)
    setSelectedThreadKey(first?.key || null)
  }

  function updateTask(machineID: string, task: MachineTask) {
    setRuntimes((current) => current.map((runtime) => runtime.machine.id === machineID
      ? {
          ...runtime,
          tasks: [task, ...runtime.tasks.filter((candidate) => candidate.id !== task.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        }
      : runtime))
  }

  function upsertCreated(runtime: Runtime, task: MachineTask) {
    // Invalidate any machine refresh that started before the mutation. Otherwise an old /v1/tasks
    // response can overwrite the optimistic new thread and leave the previous conversation visible.
    refreshGeneration.current += 1
    updateTask(runtime.machine.id, task)
    setSelectedProjectKey(`${runtime.machine.id}:${task.projectId}`)
    setSelectedThreadKey(`${runtime.machine.id}:${task.id}`)
    onActiveMachineID(runtime.machine.id)
    setRevision((value) => value + 1)
  }

  useEffect(() => {
    if (selected) onActiveMachineID(selected.runtime.machine.id)
  }, [selected?.runtime.machine.id])

  if (mode === "classic") {
    return <div className="tdw-classic-host"><button type="button" className="tdw-return" onClick={() => setMode("workspace")}>← Back to TaskDesk</button>{legacyView}</div>
  }

  if (mode === "sessions") {
    return (
      <div className="tdw-advanced-host">
        <div className="tdw-advanced-bar"><button type="button" className="tdw-button secondary" onClick={() => setMode("workspace")}>← Work Threads</button><div><strong>Advanced: Native Sessions</strong><span>Exact harness sessions for diagnostics and recovery.</span></div></div>
        <UniversalWorkspace profiles={profiles} activeProfileID={activeProfileID} onPersistProfiles={() => undefined} legacyView={legacyView} />
      </div>
    )
  }

  return (
    <div className="tdw-shell">
      <header className="tdw-topbar">
        <div className="tdw-brand"><span className="tdw-logo">T</span><div><strong>TaskDesk</strong><small>One project. One conversation. Any coding agent.</small></div></div>
        <nav className="tdw-primary-nav" aria-label="Primary">
          <button type="button" className={selectedProjectKey !== "all" ? "active" : ""} onClick={() => projects[0] ? selectProject(projects[0].key) : undefined}><FolderIcon size={16} /> Projects</button>
          <button type="button" className={selectedProjectKey === "all" ? "active" : ""} onClick={() => selectProject("all")}><ChatIcon size={16} /> Work Threads</button>
          <button type="button" onClick={onManageMachines}><ServerIcon size={16} /> Machines</button>
        </nav>
        <div className="tdw-top-actions">
          <span className="tdw-machine-health"><i className={onlineCount > 0 ? "online" : "offline"} />{onlineCount}/{machines.length} machines</span>
          <button type="button" className="tdw-icon-button" onClick={() => setRevision((value) => value + 1)} title="Refresh" aria-label="Refresh" disabled={refreshing}><RefreshIcon size={16} /></button>
          <button type="button" className="tdw-button primary" onClick={() => setNewThreadOpen(true)}><PlusIcon size={15} /> New Work Thread</button>
          <div className="tdw-more-wrap">
            <button type="button" className="tdw-icon-button" onClick={() => setMoreOpen((value) => !value)} aria-label="More" title="More"><MoreVerticalIcon size={18} /></button>
            {moreOpen ? <div className="tdw-more-menu"><button type="button" onClick={() => { setMoreOpen(false); setMode("sessions") }}>Advanced: Native Sessions</button><button type="button" onClick={() => { setMoreOpen(false); setMode("classic") }}>Classic Harness Remote</button></div> : null}
          </div>
        </div>
      </header>

      <div className="tdw-layout">
        <aside className="tdw-project-column">
          <div className="tdw-column-heading"><div><span>Workspace</span><h2>Projects</h2></div><strong>{projects.length}</strong></div>
          <button type="button" className={`tdw-project-row${selectedProjectKey === "all" ? " active" : ""}`} onClick={() => selectProject("all")}><span className="tdw-project-icon"><ChatIcon size={15} /></span><span><strong>All work</strong><small>Across every project</small></span><b>{threads.length}</b></button>
          <div className="tdw-project-list">
            {projects.map((record) => <button type="button" className={`tdw-project-row${selectedProjectKey === record.key ? " active" : ""}`} onClick={() => selectProject(record.key)} key={record.key}><span className="tdw-project-icon"><FolderIcon size={15} /></span><span><strong>{record.project.name}</strong><small>{record.runtime.snapshot?.machine.name || record.runtime.machine.name}</small></span><b>{record.count}</b></button>)}
          </div>
          <div className="tdw-project-footer"><span>{workingCount > 0 ? `${workingCount} agent${workingCount === 1 ? "" : "s"} working` : "All agents quiet"}</span><button type="button" onClick={onManageMachines}>Manage machines</button></div>
        </aside>

        <section className="tdw-thread-column">
          <div className="tdw-column-heading"><div><span>{selectedProjectKey === "all" ? "All projects" : "Project"}</span><h2>Work Threads</h2></div><strong>{visibleThreads.length}</strong></div>
          <div className="tdw-thread-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations..." /></div>
          <div className="tdw-thread-list">
            {!loaded && threads.length === 0 ? <div className="tdw-empty"><LoadingIcon size={22} /><strong>Loading your workspace...</strong></div> : visibleThreads.length === 0 ? <div className="tdw-empty"><ChatIcon size={22} /><strong>No Work Threads here yet</strong><span>Start a conversation and keep refining it until the work is done.</span><button type="button" className="tdw-button primary" onClick={() => setNewThreadOpen(true)}><PlusIcon size={14} /> New Work Thread</button></div> : visibleThreads.map((record) => {
              const state = threadState(record.task)
              const agent = agentForThread(record)
              return <button type="button" className={`tdw-thread-card${selectedThreadKey === record.key ? " selected" : ""}`} onClick={() => setSelectedThreadKey(record.key)} key={record.key}><span className={`tdw-thread-state ${state}`} /><span className="tdw-thread-card-main"><span className="tdw-thread-title"><strong>{threadTitle(record.task)}</strong><time>{formatRelative(record.task.updatedAt || record.task.createdAt)}</time></span><span className="tdw-thread-project">{record.task.project?.name || record.task.projectId}</span><span className="tdw-thread-meta">{agent?.label || threadAgentID(record.task)} · {modelLabel(record.task)}</span><span className={`tdw-thread-status ${state}`}>{threadStateLabel(record.task)}</span></span></button>
            })}
          </div>
        </section>

        <main className="tdw-main">
          {selected ? (
            <WorkThreadDetail
              key={selected.key}
              task={selected.task}
              baseConfig={selected.runtime.machine.config}
              agents={selected.runtime.agents}
              machineName={selected.runtime.snapshot?.machine.name || selected.runtime.machine.name}
              onTaskUpdate={(task) => updateTask(selected.runtime.machine.id, task)}
              onWorkspaceRefresh={() => setRevision((value) => value + 1)}
            />
          ) : (
            <div className="tdw-welcome"><div className="tdw-welcome-mark"><ChatIcon size={30} /></div><span>TaskDesk 3.0</span><h1>Pick up a conversation, not a task.</h1><p>Open a Work Thread and keep talking to the coding agent until the result is right. TaskDesk keeps the technical session underneath out of your way.</p><button type="button" className="tdw-button primary" onClick={() => setNewThreadOpen(true)}><PlusIcon size={15} /> Start a Work Thread</button></div>
          )}
        </main>
      </div>

      {newThreadOpen ? <NewWorkThreadModal runtimes={runtimes} initialMachineID={selected?.runtime.machine.id || activeMachineID} initialProjectKey={selectedProjectKey} onClose={() => setNewThreadOpen(false)} onCreated={upsertCreated} /> : null}
    </div>
  )
}
