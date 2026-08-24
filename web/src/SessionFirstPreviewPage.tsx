import { useEffect, useMemo, useState } from "react"
import { discoverMachine } from "./machineClient"
import {
  discoverMachineNativeSessions,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord
} from "./native-session-discovery"
import type { MachineSnapshot } from "./types"
import type { WorkspaceMachine } from "./workspaceMachines"
import { NativeSessionObserver } from "./components/native-session-observer"
import { LoadingIcon, RefreshIcon, ServerIcon } from "./Icons"
import "./session-first-preview.css"

type Props = {
  machines: WorkspaceMachine[]
}

type MachineState = {
  snapshot: MachineSnapshot | null
  sessions: NativeSessionRecord[]
  loading: boolean
  error: string | null
}

function statusLabel(record: NativeSessionRecord): string {
  const status = record.status?.type?.trim()
  if (status) return status
  return record.session.external ? "External" : "Ready"
}

function projectLabel(record: NativeSessionRecord): string {
  const parts = record.session.directory.split(/[\\/]/).filter(Boolean)
  return record.session.project?.name?.trim()
    || parts[parts.length - 1]
    || record.session.directory
    || "Unknown project"
}

function formatUpdated(timestamp: number): string {
  if (!timestamp) return ""
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.round(delta / 86_400_000)}d`
}

export function SessionFirstPreviewPage({ machines }: Props) {
  const [activeMachineID, setActiveMachineID] = useState(machines[0]?.id || "")
  const [state, setState] = useState<MachineState>({ snapshot: null, sessions: [], loading: false, error: null })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const activeMachine = machines.find((machine) => machine.id === activeMachineID) || machines[0]
  const selected = state.sessions.find((record) => record.key === selectedKey) || null
  const target = useMemo(() => activeMachine && selected
    ? nativeSessionSurfaceTarget(activeMachine.id, activeMachine.config, selected)
    : null, [activeMachine, selected])

  async function refresh() {
    if (!activeMachine) return
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const snapshot = await discoverMachine(activeMachine.config)
      if (!snapshot) throw new Error("This endpoint is not a Harness machine daemon.")
      const sessions = await discoverMachineNativeSessions(activeMachine.config, snapshot.agents)
      setState({ snapshot, sessions, loading: false, error: null })
      setSelectedKey((current) => current && sessions.some((record) => record.key === current) ? current : null)
    } catch (reason) {
      setState((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : String(reason) }))
    }
  }

  useEffect(() => {
    setSelectedKey(null)
    void refresh()
  }, [activeMachine?.id])

  if (!activeMachine) {
    return <div className="sf-preview-empty"><strong>No machines configured</strong><span>Add a machine in the normal Harness Remote workspace first.</span></div>
  }

  return (
    <div className="sf-preview-shell">
      <header className="sf-preview-topbar">
        <div><span>Session-first preview</span><strong>Harness Remote 3.0</strong></div>
        <label>
          <ServerIcon size={16} />
          <select value={activeMachine.id} onChange={(event) => setActiveMachineID(event.target.value)} aria-label="Machine">
            {machines.map((machine) => <option value={machine.id} key={machine.id}>{machine.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void refresh()} disabled={state.loading}>
          {state.loading ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
          Refresh
        </button>
      </header>

      <div className="sf-preview-body">
        <aside className="sf-preview-sessions" aria-label="Native Sessions">
          <div className="sf-preview-list-heading">
            <div><span>Native Sessions</span><small>{state.snapshot?.machine.name || activeMachine.name}</small></div>
            <strong>{state.sessions.length}</strong>
          </div>
          {state.error ? <div className="sf-preview-error" role="alert">{state.error}</div> : null}
          {state.loading && state.sessions.length === 0 ? <div className="sf-preview-loading"><LoadingIcon size={18} /> Discovering Sessions…</div> : null}
          {!state.loading && !state.error && state.sessions.length === 0 ? <div className="sf-preview-empty"><strong>No Sessions found</strong><span>Start or resume a Session in one of the detected coding agents, then refresh.</span></div> : null}
          <div className="sf-preview-session-list">
            {state.sessions.map((record) => (
              <button
                type="button"
                key={record.key}
                className={record.key === selectedKey ? "active" : ""}
                onClick={() => setSelectedKey(record.key)}
              >
                <div><strong>{record.session.title || "Untitled Session"}</strong><span>{projectLabel(record)}</span></div>
                <div><span>{record.agentLabel}</span><small>{statusLabel(record)} · {formatUpdated(record.session.time.updated)}</small></div>
              </button>
            ))}
          </div>
        </aside>

        <main className="sf-preview-detail">
          {target ? (
            <>
              <header className="sf-preview-session-header">
                <div><span>{projectLabel(selected!)}</span><h1>{target.title}</h1><p>{target.agentLabel} · native Session · {target.external ? "started outside Harness Remote" : "Harness Remote"}</p></div>
                <code title={target.sessionID}>{target.sessionID}</code>
              </header>
              <div className="sf-preview-chat"><NativeSessionObserver target={target} onSessionRefresh={() => void refresh()} /></div>
            </>
          ) : (
            <div className="sf-preview-empty sf-preview-detail-empty">
              <strong>Select a native Session</strong>
              <span>Observation opens the same HR3 transcript surface. No Task or Conversation is created.</span>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
