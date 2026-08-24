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
  return parts[parts.length - 1] || record.session.directory || "Project"
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
      // the already-loaded Home or make Conversations unusable.
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

  const active = useMemo(() => records.filter(({ record }) => sessionWorking(record)), [records])
  const recent = useMemo(() => records.filter(({ record }) => !sessionWorking(record)).slice(0, 8), [records])

  function open(item: RecordWithMachine) {
    onOpen(nativeSessionSurfaceTarget(item.machine.config, item.record))
  }

  return (
    <section className="hr-native-home" aria-label="Native Sessions">
      <div className="hr-native-home-heading">
        <div><span>Native Sessions</span><h2>Continue what is already running</h2></div>
        <button type="button" className="tdw-icon-button" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label="Refresh Sessions" title="Refresh Sessions">
          {loading ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
        </button>
      </div>

      {!loaded && loading ? <div className="hr-native-home-empty"><LoadingIcon size={18} /><span>Finding Sessions from your coding agents...</span></div> : null}

      {active.length ? (
        <div className="hr-native-home-group">
          <div className="hr-native-home-label"><strong>Active now</strong><span>{active.length}</span></div>
          <div className="hr-native-home-list">
            {active.map((item) => (
              <button type="button" className="hr-native-session-card active" key={`${item.machine.id}:${item.record.key}`} onClick={() => open(item)}>
                <span className="hr-native-session-state" aria-hidden="true" />
                <span className="hr-native-session-copy"><strong>{item.record.session.title || "Untitled Session"}</strong><small>{projectName(item.record)} · {item.record.agentLabel}</small></span>
                <span className="hr-native-session-side"><small>{item.machine.name}</small><b>Open</b></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {recent.length ? (
        <div className="hr-native-home-group">
          <div className="hr-native-home-label"><strong>Recent Sessions</strong><span>{recent.length}</span></div>
          <div className="hr-native-home-list">
            {recent.map((item) => (
              <button type="button" className="hr-native-session-card" key={`${item.machine.id}:${item.record.key}`} onClick={() => open(item)}>
                <span className="hr-native-session-icon"><ChatIcon size={15} /></span>
                <span className="hr-native-session-copy"><strong>{item.record.session.title || "Untitled Session"}</strong><small>{projectName(item.record)} · {item.record.agentLabel}</small></span>
                <span className="hr-native-session-side"><small>{relativeTime(item.record.session.time?.updated || 0)}</small><b>Open</b></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loaded && !loading && records.length === 0 ? (
        <div className="hr-native-home-empty"><ChatIcon size={18} /><span>No native Sessions found yet. Start one in a coding agent or create work from Harness Remote.</span></div>
      ) : null}
    </section>
  )
}
