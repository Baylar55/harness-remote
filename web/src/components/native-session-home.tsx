import { useCallback, useEffect, useMemo, useState } from "react"
import { listMachineProjects, type MachineProject } from "../machineClient"
import { canCreateNativeSession, createNativeSessionTarget } from "../native-session-create"
import {
  discoverMachineNativeSessions,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "../native-session-discovery"
import type { MachineAgentHost, MachineSnapshot } from "../types"
import type { WorkspaceMachine } from "../workspaceMachines"
import { ChatIcon, LoadingIcon, PlusIcon, RefreshIcon, SearchIcon, ServerIcon } from "../Icons"
import "../native-session-home.css"

type Source = {
  machine: WorkspaceMachine
  snapshot: MachineSnapshot | null
  state: "loading" | "online" | "offline"
  error?: string
}

type RecordWithMachine = {
  machine: WorkspaceMachine
  record: NativeSessionRecord
  project?: MachineProject
}

type ProjectGroup = {
  key: string
  machine: WorkspaceMachine
  name: string
  directory: string
  sessions: RecordWithMachine[]
  updatedAt: number
}

type CreateProject = {
  key: string
  machine: WorkspaceMachine
  snapshot: MachineSnapshot
  project: MachineProject
}
type SessionPresentationState = "working" | "attention" | "stopped" | "ready"


type Props = {
  sources: Source[]
  onOpen: (target: NativeSessionSurfaceTarget) => void
  selectedKey?: string
  selectedState?: SessionPresentationState
}

const SESSION_HOME_REFRESH_MS = 30_000
const COLLAPSED_PROJECT_SESSION_COUNT = 5
type SessionFilter = "all" | "working" | "attention"

const HARNESS_ICON_FILES: Record<string, string> = {
  codex: "codex.svg",
  claude: "claude.svg",
  opencode: "opencode.svg",
  omp: "omp.svg",
  pi: "pi.svg"
}


function sessionWorking(record: NativeSessionRecord): boolean {
  const value = record.status?.type?.trim().toLowerCase() || ""
  return value === "busy"
    || value === "running"
    || value === "working"
    || value === "waiting"
    || value === "retry"
    || value === "in_progress"
    || value === "in-progress"
}
function sessionPresentation(record: NativeSessionRecord): { state: SessionPresentationState; label: string } {
  const value = record.status?.type?.trim().toLowerCase() || ""
  if (value.includes("error") || value.includes("fail") || value.includes("attention")) {
    return { state: "attention", label: "Needs attention" }
  }
  if (value === "retry") return { state: "working", label: "Retrying" }
  if (value === "waiting") return { state: "working", label: "Waiting" }
  if (sessionWorking(record)) return { state: "working", label: "Working" }
  return { state: "ready", label: "Ready" }
}

function harnessIconUrl(backend: string): string | undefined {
  const file = HARNESS_ICON_FILES[backend.toLowerCase()]
  return file ? `${import.meta.env.BASE_URL}harness-icons/${file}` : undefined
}


function sessionActivityCompare(left: RecordWithMachine, right: RecordWithMachine): number {
  const updated = (right.record.session.time?.updated || 0) - (left.record.session.time?.updated || 0)
  if (updated) return updated
  const created = (right.record.session.time?.created || 0) - (left.record.session.time?.created || 0)
  if (created) return created
  const machine = left.machine.id.localeCompare(right.machine.id)
  if (machine) return machine
  return left.record.key.localeCompare(right.record.key)
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return ""
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.round(delta / 86_400_000)}d`
}

function fallbackProjectName(record: NativeSessionRecord): string {
  const explicit = record.session.project?.name?.trim()
  if (explicit) return explicit
  const parts = record.session.directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || record.session.directory || "Ungrouped"
}

function normalizedPath(value: string): { value: string; caseInsensitive: boolean } {
  let normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalized) normalized = "/"
  const caseInsensitive = /^[A-Za-z]:\//.test(normalized)
  if (caseInsensitive) normalized = normalized.toLowerCase()
  return { value: normalized, caseInsensitive }
}

function pathContains(projectPath: string, sessionDirectory: string): boolean {
  if (!projectPath || !sessionDirectory) return false
  const project = normalizedPath(projectPath)
  const session = normalizedPath(sessionDirectory)
  let root = project.value
  let candidate = session.value
  if (project.caseInsensitive || session.caseInsensitive) {
    root = root.toLowerCase()
    candidate = candidate.toLowerCase()
  }
  return candidate === root || candidate.startsWith(root === "/" ? "/" : `${root}/`)
}

function catalogProject(record: NativeSessionRecord, projects: MachineProject[], machineID: string): MachineProject | undefined {
  const directory = record.session.directory || ""
  if (!directory) return undefined
  return projects
    .filter((project) => project.machineId === machineID && pathContains(project.path, directory))
    .sort((left, right) => normalizedPath(right.path).value.length - normalizedPath(left.path).value.length)[0]
}

function projectGroups(records: RecordWithMachine[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const item of records) {
    const nativeDirectory = item.record.session.directory || ""
    const project = item.project
    // ProjectCatalog is authoritative when it can attribute the native cwd. Its id is already stable
    // for machine + canonical realpath. Uncatalogued Sessions keep the exact native directory as a
    // conservative fallback, so an unreadable catalog never hides or incorrectly merges Sessions.
    const directory = project?.path || nativeDirectory
    const key = project
      ? `${item.machine.id}\u0000project:${project.id}`
      : `${item.machine.id}\u0000directory:${nativeDirectory}`
    const updatedAt = item.record.session.time?.updated || 0
    const existing = groups.get(key)
    if (existing) {
      existing.sessions.push(item)
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt)
      continue
    }
    groups.set(key, {
      key,
      machine: item.machine,
      name: project?.name || fallbackProjectName(item.record),
      directory,
      sessions: [item],
      updatedAt
    })
  }

  // Status is presentation, not ordering. Moving a Session to the top merely because it enters
  // Working makes the list jump twice per turn and makes the 30s refresh look random. Native
  // activity time is the single ordering rule, with deterministic tie-breakers.
  for (const group of groups.values()) group.sessions.sort(sessionActivityCompare)

  return [...groups.values()].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
}
export function sessionTreeRows(sessions: RecordWithMachine[]): Array<{ item: RecordWithMachine; depth: number }> {
  const byID = new Map(sessions.map((item) => [item.record.session.id, item]))
  const children = new Map<string, RecordWithMachine[]>()
  const roots: RecordWithMachine[] = []
  for (const item of sessions) {
    const parentID = item.record.session.parentID
    if (!parentID || parentID === item.record.session.id || !byID.has(parentID)) {
      roots.push(item)
      continue
    }
    children.set(parentID, [...(children.get(parentID) || []), item])
  }

  const rows: Array<{ item: RecordWithMachine; depth: number }> = []
  const visited = new Set<string>()
  const visit = (item: RecordWithMachine, depth: number) => {
    if (visited.has(item.record.session.id)) return
    visited.add(item.record.session.id)
    rows.push({ item, depth })
    for (const child of children.get(item.record.session.id) || []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  // Corrupt or cyclic parent metadata must not hide a native Session.
  for (const item of sessions) visit(item, 0)
  return rows
}


function nativeCreateAgents(snapshot: MachineSnapshot): MachineAgentHost[] {
  return snapshot.agents.filter(canCreateNativeSession)
}

export function NativeSessionHome({ sources, onOpen, selectedKey, selectedState }: Props) {
  const [records, setRecords] = useState<RecordWithMachine[]>([])
  const [projectsByMachine, setProjectsByMachine] = useState<Record<string, MachineProject[]>>({})
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [createProjectKey, setCreateProjectKey] = useState("")
  const [createAgentID, setCreateAgentID] = useState("")
  const [createTitle, setCreateTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SessionFilter>("all")
  const [agentFilter, setAgentFilter] = useState("")


  useEffect(() => {
    if (!sources.length) {
      setRecords([])
      setProjectsByMachine({})
      setLoaded(true)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setDiscoveryError(null)
    void Promise.all(sources.map(async ({ machine, snapshot }) => {
      if (!snapshot) return { machine, projects: [] as MachineProject[], records: [] as RecordWithMachine[] }
      const [sessions, projects] = await Promise.all([
        discoverMachineNativeSessions(machine.config, snapshot.agents),
        listMachineProjects(machine.config).catch(() => [] as MachineProject[])
      ])
      return {
        machine,
        projects,
        records: sessions.map((record) => ({
          machine,
          record,
          project: catalogProject(record, projects, machine.id)
        }))
      }
    })).then((results) => {
      if (cancelled) return
      setProjectsByMachine(Object.fromEntries(results.map((result) => [result.machine.id, result.projects])))
      setRecords(results.flatMap((result) => result.records).sort(sessionActivityCompare))
      setLoaded(true)
    }).catch((reason) => {
      // Preserve an already loaded list, but never present a failed refresh as a genuinely empty machine.
      if (!cancelled) {
        setLoaded(true)
        setDiscoveryError(reason instanceof Error ? reason.message : String(reason))
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [sources, revision])

  useEffect(() => {
    if (!loaded || document.visibilityState !== "visible") return
    const timer = window.setInterval(() => setRevision((value) => value + 1), SESSION_HOME_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loaded])
  const presentationForItem = useCallback((item: RecordWithMachine) => {
    const targetKey = `${item.machine.id}:${item.record.key}`
    if (targetKey === selectedKey && selectedState) {
      const label = selectedState === "working"
        ? "Working"
        : selectedState === "attention"
          ? "Needs attention"
          : selectedState === "stopped"
            ? "Stopped"
            : "Ready"
      return { state: selectedState, label }
    }
    return sessionPresentation(item.record)
  }, [selectedKey, selectedState])


  const groups = useMemo(() => projectGroups(records), [records])
  useEffect(() => {
    if (!selectedKey) return
    const selectedGroup = groups.find((group) =>
      group.sessions.some((item) => `${item.machine.id}:${item.record.key}` === selectedKey)
    )
    if (!selectedGroup) return
    setCollapsedProjects((current) => {
      if (!current.has(selectedGroup.key)) return current
      const next = new Set(current)
      next.delete(selectedGroup.key)
      return next
    })
  }, [groups, selectedKey])

  const agentChoices = useMemo(() => {
    const choices = new Map<string, { id: string; label: string; count: number }>()
    for (const item of records) {
      const existing = choices.get(item.record.agentId)
      if (existing) existing.count += 1
      else choices.set(item.record.agentId, {
        id: item.record.agentId,
        label: item.record.agentLabel,
        count: 1
      })
    }
    return [...choices.values()].sort((left, right) => left.label.localeCompare(right.label))
  }, [records])
  const scopedRecords = useMemo(
    () => agentFilter ? records.filter((item) => item.record.agentId === agentFilter) : records,
    [agentFilter, records]
  )

  const activeCount = useMemo(
    () => scopedRecords.filter((item) => presentationForItem(item).state === "working").length,
    [presentationForItem, scopedRecords]
  )
  const attentionCount = useMemo(
    () => scopedRecords.filter((item) => presentationForItem(item).state === "attention").length,
    [presentationForItem, scopedRecords]
  )
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return groups.flatMap((group) => {
      const sessions = group.sessions.filter((item) => {
        const presentation = presentationForItem(item)
        if (agentFilter && item.record.agentId !== agentFilter) return false
        if (filter === "working" && presentation.state !== "working") return false
        if (filter === "attention" && presentation.state !== "attention") return false
        if (!normalizedQuery) return true
        const session = item.record.session
        return [
          session.title,
          item.record.agentLabel,
          group.name,
          group.directory,
          group.machine.name
        ].some((value) => value?.toLowerCase().includes(normalizedQuery))
      })
      return sessions.length ? [{ ...group, sessions }] : []
    })
  }, [agentFilter, filter, groups, presentationForItem, query])
  const machineGroups = useMemo(() => sources.flatMap(({ machine, snapshot, state, error }) => {
    const projects = filteredGroups.filter((group) => group.machine.id === machine.id)
    const filtering = Boolean(query.trim() || agentFilter || filter !== "all")
    if (!projects.length && filtering) return []
    return [{
      machine,
      label: snapshot?.machine.name || machine.name,
      state,
      error,
      projects,
      sessionCount: projects.reduce((count, group) => count + group.sessions.length, 0),
      workingCount: projects.reduce((count, group) =>
        count + group.sessions.filter((item) => presentationForItem(item).state === "working").length, 0),
      attentionCount: projects.reduce((count, group) =>
        count + group.sessions.filter((item) => presentationForItem(item).state === "attention").length, 0),
      updatedAt: projects.reduce((latest, group) => Math.max(latest, group.updatedAt), 0)
    }]
  }).sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label)), [agentFilter, filter, filteredGroups, presentationForItem, query, sources])
  const createProjects = useMemo<CreateProject[]>(() => sources.flatMap(({ machine, snapshot }) => {
    if (!snapshot) return []
    return (projectsByMachine[machine.id] || []).map((project) => ({
      key: `${machine.id}:${project.id}`,
      machine,
      snapshot,
      project
    }))
  }), [sources, projectsByMachine])
  const selectedCreateProject = createProjects.find((choice) => choice.key === createProjectKey) || createProjects[0]
  const createAgents = selectedCreateProject ? nativeCreateAgents(selectedCreateProject.snapshot) : []
  const selectedCreateAgent = createAgents.find((agent) => agent.id === createAgentID) || createAgents[0]

  useEffect(() => {
    if (!createOpen) return
    if (!createProjectKey && createProjects[0]) setCreateProjectKey(createProjects[0].key)
  }, [createOpen, createProjectKey, createProjects])

  useEffect(() => {
    if (!createOpen) return
    const available = selectedCreateProject ? nativeCreateAgents(selectedCreateProject.snapshot) : []
    if (!available.some((agent) => agent.id === createAgentID)) setCreateAgentID(available[0]?.id || "")
  }, [createOpen, createProjectKey, createAgentID, selectedCreateProject])

  function open(item: RecordWithMachine) {
    onOpen(nativeSessionSurfaceTarget(item.machine.id, item.machine.config, item.record))
  }

  function toggleProject(groupKey: string) {
    setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }
  function toggleProjectCollapsed(groupKey: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }


  async function createSession() {
    if (creating || !selectedCreateProject || !selectedCreateAgent) return
    setCreating(true)
    setCreateError(null)
    try {
      const { target, record } = await createNativeSessionTarget({
        machineID: selectedCreateProject.machine.id,
        baseConfig: selectedCreateProject.machine.config,
        agent: selectedCreateAgent,
        directory: selectedCreateProject.project.path,
        title: createTitle
      })
      setRecords((current) => [
        { machine: selectedCreateProject.machine, record, project: selectedCreateProject.project },
        ...current.filter((item) => !(item.machine.id === selectedCreateProject.machine.id && item.record.key === record.key))
      ].sort(sessionActivityCompare))
      setCreateTitle("")
      setCreateOpen(false)
      onOpen(target)
      setRevision((value) => value + 1)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="hr-native-home" aria-label="Sessions">
      <div className="hr-native-home-heading">
        <div>
          <h2>Sessions</h2>
          <span>{activeCount ? `${activeCount} working · ${records.length} total` : `${records.length} recent`}</span>
        </div>
        <div className="hr-native-home-actions">
          <button type="button" className="tdw-button primary hr-native-new-session" onClick={() => { setCreateError(null); setCreateOpen(true) }} aria-label="New Session">
            <PlusIcon size={15} /> <span>New Session</span>
          </button>
          <button type="button" className="tdw-icon-button" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label="Refresh Sessions" title="Refresh Sessions">
            {loading ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
          </button>
        </div>
      </div>
      {records.length > 0 ? (
        <div className="hr-native-home-tools">
          <label className="hr-native-session-search">
            <SearchIcon size={14} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search Sessions"
            />
          </label>
          <div className="hr-native-session-filters" role="group" aria-label="Filter Sessions">
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")} aria-pressed={filter === "all"}>
              All <b>{scopedRecords.length}</b>
            </button>
            <button type="button" className={filter === "working" ? "active" : ""} onClick={() => setFilter("working")} aria-pressed={filter === "working"}>
              Live <b>{activeCount}</b>
            </button>
            <button type="button" className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")} aria-pressed={filter === "attention"}>
              Attention <b>{attentionCount}</b>
            </button>
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} aria-label="Filter by coding agent">
              <option value="">All harnesses</option>
              {agentChoices.map((choice) => <option value={choice.id} key={choice.id}>{choice.label} · {choice.count}</option>)}
            </select>
          </div>
        </div>
      ) : null}


      {createOpen ? (
        <div className="hr-native-create-panel" role="group" aria-label="Create native Session">
          <div className="hr-native-create-heading">
            <div><strong>New Session</strong><small>Start a real native Session in a Project.</small></div>
            <button type="button" className="tdw-icon-button" onClick={() => !creating && setCreateOpen(false)} disabled={creating} aria-label="Close New Session">×</button>
          </div>
          <label>
            <span>Project</span>
            <select value={selectedCreateProject?.key || ""} onChange={(event) => { setCreateProjectKey(event.target.value); setCreateError(null) }} disabled={creating || createProjects.length === 0}>
              {sources.map(({ machine }) => {
                const choices = createProjects.filter((choice) => choice.machine.id === machine.id)
                return choices.length ? (
                  <optgroup label={machine.name} key={machine.id}>
                    {choices.map((choice) => <option value={choice.key} key={choice.key}>{choice.project.name}</option>)}
                  </optgroup>
                ) : null
              })}
            </select>
          </label>
          <label>
            <span>Coding agent</span>
            <select value={selectedCreateAgent?.id || ""} onChange={(event) => { setCreateAgentID(event.target.value); setCreateError(null) }} disabled={creating || createAgents.length === 0}>
              {createAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.label || agent.id}</option>)}
            </select>
          </label>
          <label className="hr-native-create-title">
            <span>Title <small>optional</small></span>
            <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} disabled={creating} placeholder={`New ${selectedCreateAgent?.label || selectedCreateAgent?.id || "native"} Session`} maxLength={200} />
          </label>
          {createProjects.length === 0 ? <div className="hr-native-create-error">No Project is available on the connected machines.</div> : null}
          {selectedCreateProject && createAgents.length === 0 ? <div className="hr-native-create-error">No installed coding agent can create a native Session on this machine yet.</div> : null}
          {createError ? <div className="hr-native-create-error" role="alert">{createError}</div> : null}
          <div className="hr-native-create-actions">
            <button type="button" className="tdw-button secondary" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</button>
            <button type="button" className="tdw-button primary" onClick={() => void createSession()} disabled={creating || !selectedCreateProject || !selectedCreateAgent}>
              {creating ? <LoadingIcon size={15} /> : <PlusIcon size={15} />}
              {creating ? "Creating..." : "Create Session"}
            </button>
          </div>
        </div>
      ) : null}

      {!loaded && loading ? <div className="hr-native-home-empty"><LoadingIcon size={18} /><span>Finding Sessions from your coding agents...</span></div> : null}
      {discoveryError ? (
        <div className="hr-native-home-notice" role="alert">
          <span><strong>Session refresh failed.</strong> Previously loaded Sessions remain available.</span>
          <button type="button" className="tdw-button secondary" onClick={() => setRevision((value) => value + 1)} disabled={loading}>Retry</button>
        </div>
      ) : null}


      <div className="hr-native-machine-list">
        {machineGroups.map(({ machine, label, state, error, projects, sessionCount, workingCount, attentionCount: machineAttentionCount }) => (
          <section className={`hr-native-machine-group ${state}`} key={machine.id} aria-label={`${label} Sessions`}>
            <header className="hr-native-machine-heading">
              <div>
                <i data-state={state} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small title={error || machine.config.host}>{state === "loading" ? "Connecting…" : state === "offline" ? error || "Machine offline" : machine.config.host}</small>
                </span>
              </div>
              <span>
                {machineAttentionCount ? <b>{machineAttentionCount} attention</b> : null}
                {workingCount ? <em>{workingCount} live</em> : null}
                <small>{state === "online" ? sessionCount : state === "loading" ? "…" : "Offline"}</small>
              </span>
            </header>
            {projects.length === 0 ? (
              <div className="hr-native-machine-empty">
                {state === "loading" ? <LoadingIcon size={15} /> : <ServerIcon size={15} />}
                <span>{state === "loading" ? "Discovering Projects and native Sessions…" : state === "offline" ? "This machine is unavailable. Its configuration is still saved." : "No native Sessions discovered on this machine."}</span>
              </div>
            ) : null}

            {projects.map((group) => {
              const expanded = expandedProjects.has(group.key)
              const collapsed = collapsedProjects.has(group.key)
              const treeRows = sessionTreeRows(group.sessions)
              const visibleRows = expanded ? treeRows : treeRows.slice(0, COLLAPSED_PROJECT_SESSION_COUNT)
              const hiddenCount = Math.max(0, treeRows.length - COLLAPSED_PROJECT_SESSION_COUNT)
              return (
                <section className={`hr-native-project-group${collapsed ? " collapsed" : ""}`} key={group.key} aria-label={`${group.name} Sessions`}>
                  <button
                    type="button"
                    className="hr-native-project-heading"
                    onClick={() => toggleProjectCollapsed(group.key)}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name} Sessions`}
                  >
                    <span>
                      <strong>{group.name}</strong>
                      <small title={group.directory}>{group.directory || "No working directory"}</small>
                    </span>
                    <span><b>{group.sessions.length}</b><i aria-hidden="true">⌄</i></span>
                  </button>
                  {!collapsed ? (
                    <>
                      <div className="hr-native-home-list">
                        {visibleRows.map(({ item, depth }) => {
                          const status = presentationForItem(item)
                          const title = item.record.session.title?.trim() || `Untitled ${item.record.agentLabel} Session`
                          const normalizedTitle = title.replace(/\s+/g, " ")
                          const accessibleTitle = normalizedTitle.length > 140 ? `${normalizedTitle.slice(0, 137)}…` : normalizedTitle
                          const tooltipTitle = normalizedTitle.length > 240 ? `${normalizedTitle.slice(0, 237)}…` : normalizedTitle
                          const timestamp = item.record.session.time?.updated || item.record.session.time?.created || 0
                          const summary = item.record.session.summary
                          const hasChanges = Boolean(summary && (summary.files || summary.additions || summary.deletions))
                          const nativeAgent = item.record.session.agent?.trim()
                          const restrictionCount = item.record.session.permission?.filter((rule) => rule.action === "deny").length || 0
                          const icon = harnessIconUrl(item.record.backend)
                          const targetKey = `${item.machine.id}:${item.record.key}`
                          const selected = targetKey === selectedKey
                          return (
                            <button
                              type="button"
                              className={`hr-native-session-row ${status.state}${selected ? " selected" : ""}${depth ? " child" : ""}`}
                              data-depth={Math.min(depth, 3)}
                              key={targetKey}
                              onClick={() => open(item)}
                              aria-current={selected ? "page" : undefined}
                              aria-label={`Open ${accessibleTitle}. ${depth ? "Child Session. " : ""}${item.record.agentLabel}.${nativeAgent ? ` Native agent ${nativeAgent}.` : ""}${restrictionCount ? ` ${restrictionCount} restrictions.` : ""} ${status.label}. ${group.name} on ${group.machine.name}.`}
                              title={tooltipTitle}
                            >
                              <span className="hr-native-session-harness" aria-hidden="true">
                                {icon ? <img src={icon} alt="" /> : <b>{item.record.agentLabel.slice(0, 2).toUpperCase()}</b>}
                                <i data-state={status.state} />
                              </span>
                              <span className="hr-native-session-copy">
                                <strong>{title}</strong>
                                <small>
                                  <span>{item.record.agentLabel}{nativeAgent ? ` · ${nativeAgent}` : ""}{item.record.session.external === true ? " · external" : ""}</span>
                                  {restrictionCount ? <span className="hr-native-session-policy">{restrictionCount} restricted</span> : null}
                                  {depth ? <span className="hr-native-session-child-label">child</span> : null}
                                  {hasChanges ? (
                                    <span className="hr-native-session-changes">
                                      <b>+{summary?.additions || 0}</b>
                                      <i>−{summary?.deletions || 0}</i>
                                      <em>{summary?.files || 0} file{summary?.files === 1 ? "" : "s"}</em>
                                    </span>
                                  ) : null}
                                </small>
                              </span>
                              <span className="hr-native-session-meta">
                                <span className="hr-native-session-status" data-state={status.state}>{status.label}</span>
                                <time dateTime={timestamp ? new Date(timestamp).toISOString() : undefined} title={timestamp ? new Date(timestamp).toLocaleString() : undefined}>
                                  {relativeTime(timestamp)}
                                </time>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {hiddenCount > 0 ? (
                        <button
                          type="button"
                          className="hr-native-project-more"
                          onClick={() => toggleProject(group.key)}
                          aria-expanded={expanded}
                        >
                          {expanded ? "Show less" : `Show ${hiddenCount} more`}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </section>
              )
            })}
          </section>
        ))}
      </div>

      {loaded && records.length > 0 && filteredGroups.length === 0 ? (
        <div className="hr-native-home-empty compact"><SearchIcon size={18} /><span>No Sessions match this view.</span></div>
      ) : null}

      {loaded && !loading && !discoveryError && records.length === 0 && sources.length === 0 ? (
        <div className="hr-native-home-empty"><ChatIcon size={18} /><span>Add a machine to discover its Projects and native Sessions.</span></div>
      ) : null}
    </section>
  )
}
