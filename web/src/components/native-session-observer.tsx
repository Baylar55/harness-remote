import { useEffect, useMemo, useState } from "react"
import { probeNativeSessionContinuation } from "../native-session-continuation"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import {
  nativeSessionIsWorking,
  registerNativeSessionV3Adapter
} from "../native-session-v3-adapter"
import type { MachineTask } from "../taskClient"
import type { MachineAgentHost } from "../types"
import { LoadingIcon } from "../Icons"
import { WorkThreadConversation } from "./work-thread-conversation"
import "../native-session-observer.css"

type WriteState = "observe" | "probing" | "ready"

type Props = {
  target: NativeSessionSurfaceTarget
  onSessionRefresh?: () => void
}

export { nativeSessionIsWorking }

/**
 * Thin Session-first adapter around the mature HR3 conversation controller.
 *
 * This component owns only native Session identity and ACP writer acquisition. Once writable, the
 * exact v3 WorkThreadConversation owns transcript paging, live routing, reasoning/activity ordering,
 * composer behavior, Stop, models, attention, error rendering and mobile behavior. The adapter
 * supplies a transient compatibility projection only. Nothing is persisted as a Task or Run.
 */
export function NativeSessionObserver({ target, onSessionRefresh }: Props) {
  const [writeState, setWriteState] = useState<WriteState>(target.requiresExplicitClaim ? "observe" : "ready")
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [task, setTask] = useState<MachineTask | null>(null)
  const writable = writeState === "ready"

  const agent = useMemo<MachineAgentHost>(() => ({
    id: target.agentID,
    label: target.agentLabel,
    backend: target.backend,
    transport: target.transport,
    managed: true,
    state: "available",
    capabilities: {
      sessions: true,
      prompt: true,
      abort: target.canStop,
      models: target.modelsSupported
    }
  }), [target.agentID, target.agentLabel, target.backend, target.transport, target.canStop, target.modelsSupported])

  useEffect(() => {
    setWriteState(target.requiresExplicitClaim ? "observe" : "ready")
    setResumeError(null)
    setTask(null)
  }, [target.key, target.requiresExplicitClaim])

  useEffect(() => {
    if (!writable) return
    const registration = registerNativeSessionV3Adapter(target, (next) => setTask(next))
    setTask(registration.task)
    return registration.dispose
  }, [target.key, writable])

  async function enableContinuation() {
    if (writeState !== "observe") return
    setWriteState("probing")
    setResumeError(null)
    const result = await probeNativeSessionContinuation(target)
    if (result.writable) {
      setWriteState("ready")
      onSessionRefresh?.()
      return
    }
    setWriteState("observe")
    setResumeError(result.reason || `${target.agentLabel} did not allow this Session to be resumed.`)
  }

  if (!writable) {
    return (
      <div className="hr-native-session-observer observe-only">
        <div className="hr-native-session-continuation" role="status">
          <div>
            <strong>Native Session is read-only until writer ownership is confirmed</strong>
            <span>{resumeError || `Continue this exact ${target.agentLabel} Session to open the validated v3 chat controller.`}</span>
          </div>
          <button type="button" className="uw-button uw-button-primary" disabled={writeState === "probing"} onClick={() => void enableContinuation()}>
            {writeState === "probing" ? <LoadingIcon size={15} /> : null}
            {writeState === "probing" ? "Checking..." : "Continue this Session"}
          </button>
        </div>
      </div>
    )
  }

  if (!task) {
    return <div className="tdw-detail-loading"><LoadingIcon size={20} /> Loading Session into the v3 controller...</div>
  }

  return (
    <div className="hr-native-session-observer writable">
      <WorkThreadConversation
        key={target.key}
        task={task}
        baseConfig={target.config}
        agents={[agent]}
        onTaskUpdate={setTask}
        onWorkspaceRefresh={onSessionRefresh}
      />
    </div>
  )
}
