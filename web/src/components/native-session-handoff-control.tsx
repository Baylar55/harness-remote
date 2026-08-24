import { useMemo, useState } from "react"
import { handoffNativeSession } from "../native-session-handoff"
import {
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "../native-session-discovery"
import type { MachineAgentHost } from "../types"
import "../native-session-handoff.css"

type Props = {
  source: NativeSessionSurfaceTarget
  agents: MachineAgentHost[]
  onOpen: (target: NativeSessionSurfaceTarget) => void
}

function canHostSessions(agent: MachineAgentHost): boolean {
  return agent.capabilities?.sessions !== false
}

export function NativeSessionHandoffControl({ source, agents, onOpen }: Props) {
  const targets = useMemo(
    () => agents.filter((agent) => agent.id !== source.agentID && canHostSessions(agent)),
    [agents, source.agentID]
  )
  const [open, setOpen] = useState(false)
  const [targetAgentID, setTargetAgentID] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  if (!source.directory || targets.length === 0) return null

  async function continueWithAgent() {
    const targetAgent = targets.find((agent) => agent.id === targetAgentID)
    if (!targetAgent || working) return
    setWorking(true)
    setError("")
    try {
      const title = `${source.title} · ${targetAgent.label || targetAgent.id}`
      const response = await handoffNativeSession(source, targetAgent.id, title)
      if (response.status !== "accepted" || !response.result?.target?.sessionID) {
        setError(response.status === "uncertain"
          ? "Handoff delivery is uncertain. Retry the same agent to reconcile it safely."
          : "Handoff is still pending. Retry the same agent to check its status.")
        return
      }

      const now = Date.now()
      const record: NativeSessionRecord = {
        key: `${targetAgent.id}:${response.result.target.sessionID}`,
        agentId: targetAgent.id,
        agentLabel: targetAgent.label || targetAgent.id,
        backend: targetAgent.backend === "opencode" || targetAgent.backend === "omp" || targetAgent.backend === "pi" || targetAgent.backend === "claude" || targetAgent.backend === "codex"
          ? targetAgent.backend
          : source.backend,
        transport: targetAgent.transport,
        stopCapability: targetAgent.contract?.sessions?.stop,
        abortSupported: targetAgent.capabilities?.abort === true,
        modelsSupported: targetAgent.capabilities?.models === true,
        // The daemon created this target Session and owns its ACP writer already. Treating it like a
        // discovered external Session forced a redundant second "Continue this Session" step.
        writerOwned: true,
        session: {
          id: response.result.target.sessionID,
          title,
          directory: response.result.target.directory || source.directory,
          time: { created: now, updated: now },
          summary: { additions: 0, deletions: 0, files: 0 },
          external: false
        },
        status: { type: "idle" }
      }
      onOpen(nativeSessionSurfaceTarget(source.machineID, { ...source.config, agentId: undefined }, record))
      setOpen(false)
      setTargetAgentID("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="hr-native-handoff">
      <button
        type="button"
        className="tdw-button secondary hr-native-handoff-trigger"
        onClick={() => { setOpen((value) => !value); setError("") }}
        aria-expanded={open}
      >
        Continue with another agent
      </button>
      {open ? (
        <div className="hr-native-handoff-panel">
          <label>
            <span>Coding agent</span>
            <select value={targetAgentID} onChange={(event) => { setTargetAgentID(event.target.value); setError("") }} disabled={working}>
              <option value="">Choose an agent</option>
              {targets.map((agent) => (
                <option value={agent.id} key={agent.id}>{agent.label || agent.id}{agent.state === "available" ? "" : ` · ${agent.state}`}</option>
              ))}
            </select>
          </label>
          <button type="button" className="tdw-button primary" disabled={!targetAgentID || working} onClick={() => void continueWithAgent()}>
            {working ? "Creating Session..." : "Continue"}
          </button>
          {error ? <p className="hr-native-handoff-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
