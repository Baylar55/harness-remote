import { api } from "./api"
import type { BackendKind, MachineAgentHost, ServerConfig, Session, SessionStatus } from "./types"

export type NativeSessionRecord = {
  key: string
  agentId: string
  agentLabel: string
  backend: BackendKind
  session: Session
  status?: SessionStatus
}

function supportedBackend(value: string, fallback: BackendKind): BackendKind {
  return value === "opencode" || value === "omp" || value === "pi" || value === "claude" || value === "codex"
    ? value
    : fallback
}

/**
 * A machine profile addresses the daemon. Native Session reads must then be scoped to the exact
 * harness that owns the Session, otherwise a multi-harness machine silently falls back to the
 * daemon's primary agent. Keep this derivation in one place so Session-first UI never invents a
 * second routing policy.
 */
export function nativeSessionConfig(base: ServerConfig, agent: MachineAgentHost): ServerConfig {
  return {
    ...base,
    backend: supportedBackend(agent.backend || agent.id, base.backend),
    agentId: agent.id
  }
}

export type NativeSessionReadApi = Pick<typeof api, "listGlobalSessions" | "listSessions" | "listStatuses">

/**
 * Read-only discovery for one native harness. The experimental global listing is preferred because
 * it already provides pagination for large histories; harnesses that do not expose it fall back to
 * the stable Session endpoint. Status is enrichment only and must never make discovery fail.
 *
 * This intentionally does not create/adopt/attach a Task or Conversation. A Session started outside
 * Harness Remote must be visible as itself before we decide whether HR may continue writing to it.
 */
export async function discoverAgentNativeSessions(
  base: ServerConfig,
  agent: MachineAgentHost,
  client: NativeSessionReadApi = api
): Promise<NativeSessionRecord[]> {
  if (agent.capabilities?.sessions === false) return []
  const config = nativeSessionConfig(base, agent)
  const sessions = await client.listGlobalSessions(config).catch(() => client.listSessions(config))
  const statuses = await client.listStatuses(config).catch(() => ({} as Record<string, SessionStatus>))
  return sessions.map((session) => ({
    key: `${agent.id}:${session.id}`,
    agentId: agent.id,
    agentLabel: agent.label || agent.id,
    backend: config.backend,
    session,
    status: statuses[session.id]
  }))
}

/**
 * Discover every harness independently. One broken or lazily unavailable adapter must not hide the
 * Sessions of the other harnesses on the same machine.
 */
export async function discoverMachineNativeSessions(
  base: ServerConfig,
  agents: MachineAgentHost[],
  client: NativeSessionReadApi = api
): Promise<NativeSessionRecord[]> {
  const groups = await Promise.all(agents.map((agent) =>
    discoverAgentNativeSessions(base, agent, client).catch(() => [] as NativeSessionRecord[])
  ))
  return groups
    .flat()
    .sort((left, right) => (right.session.time?.updated || 0) - (left.session.time?.updated || 0))
}
