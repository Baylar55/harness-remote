import { useEffect, useMemo, useState } from "react"
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

function projectName(record: NativeSessionRecord): string {
  const explicit = record.session.project?.name?.trim()
  if (explicit) return explicit
  const parts = record.session.directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || record.session.directory || "Ungrouped"
}

function projectGroups(records: RecordWithMachine[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const item of records) {
    // The canonical directory stays in the identity. A basename is display copy only: two machines
    // or two different paths named "app" must never collapse into one Project in the Session list.
    const directory = item.record.session.directory || ""
    const key = `${item.machine.id}\u0000${directory}`
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
      name: projectName(item.record),
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
      const sessions = await discoverMachineNativeSessions(machine.config, snapshot.agents)
      return sessions.map((record) => ({ machine, record }))
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
    onOpen(nativeSessionSurfaceTarget(item.machine.config, item.record))
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

      {groups.map((group) => (
        <section className="hr-native-project-group" key={group.key} aria-label={`${group.name} Sessions`}>
          <div className="hr-native-project-heading">
            <div>
              <strong>{group.name}</strong>
              <small title={group.directory}>{group.directory || "No working directory"}</small>
            </div>
            {multipleMachines ? <span title={group.machine.config.host}>{group.machine.name}</span> : null}
          </div>
          <div className="hr-native-home-list">
            {group.sessions.map((item) => {
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
        </section>
      ))}

      {loaded && !loading && records.length === 0 ? (
        <div className="hr-native-home-empty"><ChatIcon size={18} /><span>No Sessions found yet. Start one in a coding agent and it will appear here.</span></div>
      ) : null}
    </section>
  )
}
