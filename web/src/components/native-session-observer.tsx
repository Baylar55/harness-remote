import { useEffect, useMemo, useState } from "react"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import { resolveNativeSessionTargetModel } from "../native-session-model"
import {
  nativeSessionIsWorking,
  registerNativeSessionV3Adapter
} from "../native-session-v3-adapter"
import type { MachineTask } from "../taskClient"
import type { MachineAgentHost } from "../types"
import { LoadingIcon } from "../Icons"
import { WorkThreadConversation } from "./work-thread-conversation"
import "../native-session-observer.css"

type Props = {
  target: NativeSessionSurfaceTarget
  onSessionRefresh?: () => void
}

export { nativeSessionIsWorking }

/**
 * Thin Session-first adapter around the mature HR3 conversation controller.
 *
 * Opening a Session is always a read operation. The exact v3 WorkThreadConversation therefore owns
 * transcript paging and rendering immediately, even when an ACP writer has not been acquired yet.
 * Writer acquisition is deferred to the first mutation by native-session-v3-adapter, so the user
 * never has to unlock the transcript with an extra Continue step. Nothing is persisted as a Task or Run.
 */
export function NativeSessionObserver({ target, onSessionRefresh }: Props) {
  const [task, setTask] = useState<MachineTask | null>(null)

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
    void resolveNativeSessionTargetModel(target).then((resolvedTarget) => {
      if (disposed) return
      registration = registerNativeSessionV3Adapter(resolvedTarget, (next) => setTask(next))
      setTask(registration.task)
    })

    return () => {
      disposed = true
      registration?.dispose()
    }
  }, [target.key])

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
