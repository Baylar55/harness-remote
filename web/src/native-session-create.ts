import { api } from "./api"
import {
  nativeSessionConfig,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "./native-session-discovery"
import type { MachineAgentHost, ServerConfig } from "./types"

/**
 * Create one real harness-owned Session through the existing mature /session endpoint.
 *
 * This is intentionally a very small Session-first adapter. It does not create or persist a Task,
 * Conversation or Run. ACP createSession owns the writer immediately, so the returned target can
 * enter the validated v3 conversation controller without a redundant claim round trip.
 */
export async function createNativeSessionTarget({
  machineID,
  baseConfig,
  agent,
  directory,
  title
}: {
  machineID: string
  baseConfig: ServerConfig
  agent: MachineAgentHost
  directory: string
  title?: string
}): Promise<{ target: NativeSessionSurfaceTarget; record: NativeSessionRecord }> {
  if (agent.backend !== "pi" || agent.transport !== "acp") {
    throw new Error("New Session is currently enabled only for PI while native create parity is validated.")
  }
  if (!directory.trim()) throw new Error("Choose a Project before creating a Session.")

  const config = nativeSessionConfig(baseConfig, agent)
  const session = await api.createSession(config, title?.trim() || undefined, undefined, directory)
  if (!session?.id) throw new Error("PI did not return a native Session id.")

  const record: NativeSessionRecord = {
    key: `${agent.id}:${session.id}`,
    agentId: agent.id,
    agentLabel: agent.label || agent.id,
    backend: config.backend,
    transport: agent.transport,
    stopCapability: agent.contract?.sessions?.stop,
    abortSupported: agent.capabilities?.abort === true,
    modelsSupported: agent.capabilities?.models === true,
    writerOwned: true,
    session
  }

  return {
    record,
    target: nativeSessionSurfaceTarget(machineID, baseConfig, record)
  }
}
