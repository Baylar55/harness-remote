import { useEffect, useMemo, useState } from "react"
import { listMachineProjects, type MachineProject } from "../machineClient"
import { createNativeSessionTarget } from "../native-session-create"
import {
  discoverMachineNativeSessions,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "../native-session-discovery"
import type { MachineAgentHost, MachineSnapshot } from "../types"
import type { WorkspaceMachine } from "../workspaceMachines"
import { ChatIcon, LoadingIcon, PlusIcon, RefreshIcon } from "../Icons"
import "../native-session-home.css"

type Source = {
  machine: WorkspaceMachine
  snapshot: MachineSnapshot
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

type Props = {
  sources: Source[]
  onOpen: (target: NativeSessionSurfaceTarget) => void
}

const SESSION_HOME_REFRESH_MS = 30_000
const COLLAPSED_PROJECT_SESSION_COUNT = 5

function sessionWorking(record: NativeSessionRecord): boolean {
  const value = record.status?.type?.trim().toLowerCase() || ""
  return value === "busy" || value === "running" || value === "working" || value === "in_progress" || value === "in-progress"
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

  for (const group of groups.values()) {
    group.sessions.sort((left, right) => {
      const workingDelta = Number(sessionWorking(right.record)) - Number(sessionWorking(left.record))
      if (workingDelta) return workingDelta
      return (right.record.session.time?.updated || 0) - (left.record.session.time?.updated || 0)
    })
  }

  return [...groups.values()].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
}

function piCreateAgents(snapshot: MachineSnapshot): MachineAgentHost[] {
  return snapshot.agents.filter((agent) => agent.backend === "pi" && agent.transport === "acp" && agent.capabilities?.sessions !== false)
}

export function NativeSessionHome({ sources, onOpen }: Props) {
  const [records, setRecords] = useState<RecordWithMachine[]>([])
  const [projectsByMachine, setProjectsByMachine] = useState<Record<string, MachineProject[]>>({})
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [createProjectKey, setCreateProjectKey] = useState("")
  const [createAgentID, setCreateAgentID] = useState("")
  const [createTitle, setCreateTitle] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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
    void Promise.all(sources.map(async ({ machine, snapshot }) => {
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
      setRecords(results.flatMap((result) => result.records).sort((left, right) => (right.record.session.time?.updated || 0) - (left.record.session.time?.updated || 0)))
      setLoaded(true)
    }).catch(() => {
      // Session discovery is enrichment for the Home. A transient adapter failure must not replace
      // the already-loaded Home or make the rest of Harness Remote unusable.
      if (!cancelled) setLoaded(true)
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

  const groups = useMemo(() => projectGroups(records), [records])
  const activeCount = useMemo(() => records.filter(({ record }) => sessionWorking(record)).length, [records])
  const multipleMachines = sources.length > 1
  const createProjects = useMemo<CreateProject[]>(() => sources.flatMap(({ machine, snapshot }) =>
    (projectsByMachine[machine.id] || []).map((project) => ({
      key: `${machine.id}:${project.id}`,
      machine,
      snapshot,
      project
    }))
  ), [sources, projectsByMachine])
  const selectedCreateProject = createProjects.find((choice) => choice.key === createProjectKey) || createProjects[0]
  const createAgents = selectedCreateProject ? piCreateAgents(selectedCreateProject.snapshot) : []
  const selectedCreateAgent = createAgents.find((agent) => agent.id === createAgentID) || createAgents[0]

  useEffect(() => {
    if (!createOpen) return
    if (!createProjectKey && createProjects[0]) setCreateProjectKey(createProjects[0].key)
  }, [createOpen, createProjectKey, createProjects])

  useEffect(() => {
    if (!createOpen) return
    const available = selectedCreateProject ? piCreateAgents(selectedCreateProject.snapshot) : []
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
      ])
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
          <span>{activeCount ? `${activeCount} active · ${records.length} total` : `${records.length} recent`}</span>
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

      {createOpen ? (
        <div className="hr-native-create-panel" role="group" aria-label="Create native Session">
          <div className="hr-native-create-heading">
            <div><strong>New native Session</strong><small>Creates a real PI Session in the selected Project.</small></div>
            <button type="button" className="tdw-icon-button" onClick={() => !creating && setCreateOpen(false)} disabled={creating} aria-label="Close New Session">×</button>
          </div>
          <label>
            <span>Project</span>
            <select value={selectedCreateProject?.key || ""} onChange={(event) => { setCreateProjectKey(event.target.value); setCreateError(null) }} disabled={creating || createProjects.length === 0}>
              {createProjects.map((choice) => <option value={choice.key} key={choice.key}>{choice.project.name}{multipleMachines ? ` · ${choice.machine.name}` : ""}</option>)}
            </select>
          </label>
          <label>
            <span>Coding agent</span>
            <select value={selectedCreateAgent?.id || ""} onChange={(event) => { setCreateAgentID(event.target.value); setCreateError(null) }} disabled={creating || createAgents.length === 0}>
              {createAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.label || "PI"}</option>)}
            </select>
          </label>
          <label className="hr-native-create-title">
            <span>Title <small>optional</small></span>
            <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} disabled={creating} placeholder="New PI Session" maxLength={200} />
          </label>
          {createProjects.length === 0 ? <div className="hr-native-create-error">No Project is available on the connected machines.</div> : null}
          {selectedCreateProject && createAgents.length === 0 ? <div className="hr-native-create-error">PI is not available for native Session creation on this machine yet.</div> : null}
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

      {groups.map((group) => {
        const expanded = expandedProjects.has(group.key)
        const visibleSessions = expanded ? group.sessions : group.sessions.slice(0, COLLAPSED_PROJECT_SESSION_COUNT)
        const hiddenCount = Math.max(0, group.sessions.length - COLLAPSED_PROJECT_SESSION_COUNT)
        return (
          <section className="hr-native-project-group" key={group.key} aria-label={`${group.name} Sessions`}>
            <div className="hr-native-project-heading">
              <div>
                <strong>{group.name}</strong>
                <small title={group.directory}>{group.directory || "No working directory"}</small>
              </div>
              {multipleMachines ? <span title={group.machine.config.host}>{group.machine.name}</span> : null}
            </div>
            <div className="hr-native-home-list">
              {visibleSessions.map((item) => {
                const working = sessionWorking(item.record)
                return (
                  <button
                    type="button"
                    className={`hr-native-session-row${working ? " active" : ""}`}
                    key={`${item.machine.id}:${item.record.key}`}
                    onClick={() => open(item)}
                    aria-label={`Open ${item.record.session.title || "Untitled Session"} in ${item.record.agentLabel}`}
                  >
                    <span className="hr-native-session-state" data-state={working ? "active" : "idle"} aria-hidden="true" />
                    <span className="hr-native-session-copy">
                      <strong>{item.record.session.title || "Untitled Session"}</strong>
                      <small>{item.record.agentLabel}{item.record.session.external === true ? " · started outside Harness Remote" : ""}</small>
                    </span>
                    <span className="hr-native-session-time">{relativeTime(item.record.session.time?.updated || 0)}</span>
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
          </section>
        )
      })}

      {loaded && !loading && records.length === 0 ? (
        <div className="hr-native-home-empty"><ChatIcon size={18} /><span>No Sessions found yet. Create a native PI Session to start working in this Project.</span></div>
      ) : null}
    </section>
  )
}
