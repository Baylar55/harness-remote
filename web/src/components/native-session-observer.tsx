import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import { resolveNativeSessionTargetModel } from "../native-session-model"
import {
  applyDiscoveredNativeSessionModel,
  nativeSessionIsWorking,
  registerNativeSessionV3Adapter
} from "../native-session-v3-adapter"
import type { AgentModelScope, MachineTask } from "../taskClient"
import type { MachineAgentHost } from "../types"
import { LoadingIcon } from "../Icons"
import { WorkThreadConversation } from "./work-thread-conversation"
import "../native-session-observer.css"

type Props = {
  target: NativeSessionSurfaceTarget
  onSessionRefresh?: () => void
  onStateChange?: (state: NativeSessionVisualState) => void
}
export type NativeSessionVisualState = "working" | "attention" | "stopped" | "ready"

function visualState(task: MachineTask, attention = false): NativeSessionVisualState {
  if (attention || task.status === "failed") return "attention"
  if (task.status === "cancelled") return "stopped"
  if (nativeSessionIsWorking(task.status)) return "working"
  return "ready"
}


export { nativeSessionIsWorking }

/**
 * The daemon owns one model catalog per machine + harness, which is what its capability contract
 * reports as `cacheScope: "machine"`. A native Session therefore asks for exactly that catalog and
 * must not invent a Work Thread identity the daemon has never heard of. Keeping this constant module
 * scoped also keeps the object identity stable across renders.
 */
const NATIVE_SESSION_MODEL_SCOPE: AgentModelScope = {}

/**
 * Thin Session-first adapter around the mature HR3 conversation controller.
 *
 * Opening a Session is always a read operation. The exact v3 WorkThreadConversation therefore owns
 * transcript paging and rendering immediately, even when an ACP writer has not been acquired yet.
 * Writer acquisition is deferred to the first mutation by native-session-v3-adapter, so the user
 * never has to unlock the transcript with an extra Continue step. Nothing is persisted as a Task or Run.
 */
export function NativeSessionObserver({ target, onSessionRefresh, onStateChange }: Props) {
  const [task, setTask] = useState<MachineTask | null>(null)
  const taskRef = useRef<MachineTask | null>(null)
  const attentionRef = useRef(false)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const handleTaskUpdate = useCallback((next: MachineTask) => {
    taskRef.current = next
    setTask(next)
    onStateChangeRef.current?.(visualState(next, attentionRef.current))
  }, [])

  const handleAttentionChange = useCallback((attention: boolean) => {
    attentionRef.current = attention
    const current = taskRef.current
    if (current) onStateChangeRef.current?.(visualState(current, attention))
  }, [])

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
    let disposed = false
    let registration: ReturnType<typeof registerNativeSessionV3Adapter> | undefined

    setTask(null)
    taskRef.current = null
    attentionRef.current = false

    // Mount the mature controller on the Session itself, before any model enrichment. Gating the
    // whole transcript on a network read left this surface stuck on "Loading Session into the v3
    // controller..." whenever that read was slow, which is exactly what a busy daemon produces.
    registration = registerNativeSessionV3Adapter(target, handleTaskUpdate)
    handleTaskUpdate(registration.task)

    // Recovering the last requested native model is enrichment. It refines the already usable
    // Session and must never be able to fail it.
    void resolveNativeSessionTargetModel(target).then((resolved) => {
      if (disposed || resolved.model === target.model) return
      applyDiscoveredNativeSessionModel(target, resolved.model)
    })

    return () => {
      disposed = true
      registration?.dispose()
    }
  }, [target.key, handleTaskUpdate])

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
        modelScope={NATIVE_SESSION_MODEL_SCOPE}
        onTaskUpdate={handleTaskUpdate}
        onWorkspaceRefresh={onSessionRefresh}
        onAttentionChange={handleAttentionChange}
      />
    </div>
  )
}
