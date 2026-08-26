import { api } from "./api"
import {
  nativeSessionConfig,
  nativeSessionSurfaceTarget,
  type NativeSessionRecord,
  type NativeSessionSurfaceTarget
} from "./native-session-discovery"
import type { MachineAgentHost, ServerConfig } from "./types"

/**
 * Native create uses the same mature /session route for every harness transport that can own a
 * writable Session. ACP's implementation is deliberately generic (`session/new`) and OpenCode owns
 * the equivalent HTTP lifecycle, so the UI must not hide OMP, Claude or Codex behind an old rollout
 * gate that was only meant for the first Session-first validation pass.
 */
export function canCreateNativeSession(agent: MachineAgentHost): boolean {
  const supportedTransport = agent.transport === "acp" || agent.transport === "http"
  return supportedTransport
    && agent.state !== "unavailable"
    && agent.capabilities?.sessions !== false
    && agent.capabilities?.prompt !== false
}

/**
 * Create one real harness-owned Session through the existing mature /session endpoint.
 *
 * This is intentionally a very small Session-first adapter. It does not create or persist a Task,
 * Conversation or Run. A Session created through the owning harness is immediately writable: ACP
 * owns the new writer already, while OpenCode's HTTP server owns writer coordination itself.
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
  if (!canCreateNativeSession(agent)) {
    throw new Error("This harness does not expose writable native Sessions on its current transport.")
  }
  if (!directory.trim()) throw new Error("Choose a Project before creating a Session.")

  const config = nativeSessionConfig(baseConfig, agent)
  const session = await api.createSession(config, title?.trim() || undefined, undefined, directory)
  if (!session?.id) throw new Error(`${agent.label || agent.id} did not return a native Session id.`)

  const record: NativeSessionRecord = {
    key: `${agent.id}:${session.id}`,
    agentId: agent.id,
    agentLabel: agent.label || agent.id,
    backend: config.backend,
    transport: agent.transport,
    stopCapability: agent.contract?.sessions?.stop,
    abortSupported: agent.capabilities?.abort === true,
    modelsSupported: agent.capabilities?.models === true,
    renameSupported: agent.capabilities?.sessionRename === true,
    deleteSupported: agent.capabilities?.sessionDelete === true,
    writerOwned: true,
    session
  }

  return {
    record,
    target: nativeSessionSurfaceTarget(machineID, baseConfig, record)
  }
}
