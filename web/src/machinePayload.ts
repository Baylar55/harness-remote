import type { MachineSnapshot, ServerConfig } from "./types"

/**
 * Pure machine-discovery helpers. These distinguish a direct harness endpoint from the machine
 * daemon that owns TaskDesk project/task APIs, including native payload normalization.
 *
 * Restored from the archived task-first work in PR #172.
 */
export const DEFAULT_MACHINE_DAEMON_PORT = 4097

export function unwrapPayload(value: unknown): unknown {
  let candidate = value
  for (let pass = 0; pass < 3; pass += 1) {
    if (typeof candidate === "string") {
      const text = candidate.replace(/^\uFEFF/, "").trim()
      if (!text) return candidate
      try {
        candidate = JSON.parse(text)
        continue
      } catch {
        return candidate
      }
    }
    if (candidate && typeof candidate === "object" && "data" in candidate) {
      candidate = (candidate as { data?: unknown }).data
      continue
    }
    break
  }
  return candidate
}

export function parseMachineSnapshot(value: unknown): MachineSnapshot | null {
  const snapshot = unwrapPayload(value) as Partial<MachineSnapshot> | null
  if (!snapshot?.machine || typeof snapshot.machine.id !== "string" || !Array.isArray(snapshot.agents)) return null
  return snapshot as MachineSnapshot
}

export function isProjectListing(value: unknown): boolean {
  const listing = unwrapPayload(value) as { projects?: unknown } | null
  return Array.isArray(listing?.projects)
}

export function machineCandidates(config: ServerConfig): ServerConfig[] {
  const current = { ...config }
  if (config.backend !== "opencode" || config.port === DEFAULT_MACHINE_DAEMON_PORT) return [current]
  return [
    current,
    { ...config, port: DEFAULT_MACHINE_DAEMON_PORT, agentId: config.agentId?.trim() || "opencode" }
  ]
}

export function selectableMachineAgents(machine: MachineSnapshot): MachineSnapshot["agents"] {
  return (Array.isArray(machine.agents) ? machine.agents : [])
    .filter((agent) => agent.state === "available" || agent.state === "configured")
}
