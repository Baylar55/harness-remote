import { useEffect, useMemo, useState } from "react"
import { listMachineProjects, type MachineProject } from "../machineClient"
import {
  discoverMachineNativeSessions,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "../native-session-discovery"
import type { MachineSnapshot } from "../types"
import type { WorkspaceMachine } from "../workspaceMachines"
import { ChatIcon, LoadingIcon, RefreshIcon } from "../Icons"
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

export function NativeSessionHome({ sources, onOpen }: Props) {
  const [records, setRecords] = useState<RecordWithMachine[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!sources.length) {
      setRecords([])
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
      return sessions.map((record) => ({
        machine,
        record,
        project: catalogProject(record, projects, machine.id)
      }))
    })).then((groups) => {
      if (cancelled) return
      setRecords(groups.flat().sort((left, right) => (right.record.session.time?.updated || 0) - (left.record.session.time?.updated || 0)))
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

  return (
    <section className="hr-native-home" aria-label="Sessions">
      <div className="hr-native-home-heading">
        <div>
          <h2>Sessions</h2>
          <span>{activeCount ? `${activeCount} active · ${records.length} total` : `${records.length} recent`}</span>
        </div>
        <button type="button" className="tdw-icon-button" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label="Refresh Sessions" title="Refresh Sessions">
          {loading ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

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
        <div className="hr-native-home-empty"><ChatIcon size={18} /><span>No Sessions found yet. Start one in a coding agent and it will appear here.</span></div>
      ) : null}
    </section>
  )
}
