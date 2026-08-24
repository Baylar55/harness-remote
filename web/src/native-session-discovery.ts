import { api } from "./api"
import type { BackendKind, MachineAgentHost, ServerConfig, Session, SessionStatus } from "./types"

export type NativeSessionRecord = {
  key: string
  agentId: string
  agentLabel: string
  backend: BackendKind
  transport: string
  session: Session
  status?: SessionStatus
}

/** Stable identity for one real native coding-agent Session across every configured machine. */
export type NativeSessionRef = {
  machineID: string
  agentID: string
  sessionID: string
  directory: string
}

/**
 * This is the minimal input the existing HR3 chat surface needs in order to render one real native
 * Session. It deliberately contains no Task/Conversation identity: discovery and observation must
 * work for Sessions that were started entirely outside Harness Remote.
 *
 * `ref` is the operation identity. Native session ids are harness-owned and are not assumed to be
 * globally unique across agents or machines, so every mutation keeps machine + agent + native id.
 */
export type NativeSessionSurfaceTarget = {
  key: string
  ref: NativeSessionRef
  machineID: string
  sessionID: string
  directory: string
  title: string
  agentID: string
  agentLabel: string
  backend: BackendKind
  transport: string
  config: ServerConfig
  status?: SessionStatus
  external: boolean
  /** Lightweight ACP discovery cannot prove that this bridge owns the writer. Require a deliberate
   * claim before exposing the composer even when the Session itself was originally created by HR. */
  requiresExplicitClaim: boolean
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

/**
 * Convert discovery data into the same primitive the HR3 transcript/composer can consume next.
 * This is a view-model conversion only. It never adopts, resumes or creates anything on the daemon.
 *
 * ACP discovery is intentionally conservative: `/experimental/session` is metadata-only and cannot
 * prove this process owns a native writer. Every ACP Session therefore starts observe-only until the
 * explicit claim operation succeeds. Managed HTTP harnesses such as OpenCode keep their native
 * server ownership semantics and only require a claim when the harness itself marks the Session
 * external.
 */
export function nativeSessionSurfaceTarget(
  machineID: string,
  base: ServerConfig,
  record: NativeSessionRecord
): NativeSessionSurfaceTarget {
  const directory = record.session.directory || ""
  const ref: NativeSessionRef = {
    machineID,
    agentID: record.agentId,
    sessionID: record.session.id,
    directory
  }
  const external = record.session.external === true
  return {
    key: `${machineID}:${record.key}`,
    ref,
    machineID,
    sessionID: ref.sessionID,
    directory: ref.directory,
    title: record.session.title?.trim() || "Untitled Session",
    agentID: ref.agentID,
    agentLabel: record.agentLabel,
    backend: record.backend,
    transport: record.transport,
    config: {
      ...base,
      backend: record.backend,
      agentId: record.agentId
    },
    status: record.status,
    external,
    requiresExplicitClaim: record.transport === "acp" || external
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
    transport: agent.transport,
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
