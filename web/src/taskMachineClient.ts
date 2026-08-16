import { Capacitor, CapacitorHttp } from "@capacitor/core"
import { desktopRequestResult, isDesktopPlatform } from "./desktopBridge"
import { machineCandidates, parseMachineSnapshot, selectableMachineAgents } from "./machinePayload"
import { authHeader, hasCredentials, machineBaseUrl } from "./serverConfig"
import type { MachineSnapshot, ServerConfig } from "./types"

export { selectableMachineAgents }

export type MachineConnection = {
  machine: MachineSnapshot
  config: ServerConfig
}

function headers(config: ServerConfig): Record<string, string> {
  const value: Record<string, string> = { Accept: "application/json" }
  if (hasCredentials(config)) value.Authorization = authHeader(config)
  return value
}

function noMachineStatus(status: number | undefined): boolean {
  return status === 404 || status === 503
}

function unauthorized(config: ServerConfig): Error {
  return new Error(hasCredentials(config)
    ? "HTTP 401: the server rejected these credentials."
    : "HTTP 401: this server requires a username and password, and none were sent.")
}

async function nativeGet(config: ServerConfig, path: string) {
  const target = `${machineBaseUrl(config)}${path}`
  try {
    return await CapacitorHttp.get({ url: target, headers: headers(config), connectTimeout: 12_000, readTimeout: 12_000 })
  } catch {
    throw new Error(`Cannot reach ${config.host}:${config.port}.`)
  }
}

async function browserGet(config: ServerConfig, path: string): Promise<Response> {
  const target = `${machineBaseUrl(config)}${path}`
  try {
    return await fetch(target, { headers: headers(config) })
  } catch {
    throw new Error(`Cannot reach ${config.host}:${config.port}.`)
  }
}

async function discoverMachinePath(config: ServerConfig, path: string): Promise<MachineSnapshot | null> {
  if (isDesktopPlatform()) {
    const result = await desktopRequestResult(config, { path })
    if (!result.ok) {
      if (result.error.code === "http" && noMachineStatus(result.error.status)) return null
      if (result.error.code === "http" && result.error.status === 401) throw unauthorized(config)
      throw new Error(result.error.message)
    }
    return parseMachineSnapshot(result.response.data)
  }

  if (Capacitor.isNativePlatform()) {
    const response = await nativeGet(config, path)
    if (noMachineStatus(response.status)) return null
    if (response.status === 401) throw unauthorized(config)
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
    return parseMachineSnapshot(response.data)
  }

  const response = await browserGet(config, path)
  if (noMachineStatus(response.status)) return null
  if (response.status === 401) throw unauthorized(config)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return parseMachineSnapshot(await response.json())
}

/** Both routes are published; older machine daemons may answer only the second. */
async function discoverAt(config: ServerConfig): Promise<MachineSnapshot | null> {
  for (const path of ["/v1/machine", "/global/machine"]) {
    const machine = await discoverMachinePath(config, path)
    if (machine) return machine
  }
  return null
}

/**
 * TaskDesk-only machine resolution. A direct OpenCode profile commonly points at 4096 while the
 * machine daemon defaults to 4097, so this opt-in path may probe both candidates. The ordinary app
 * continues to use machineClient.ts and retains its single configured-endpoint request.
 */
export async function discoverMachineConnection(config: ServerConfig): Promise<MachineConnection | null> {
  let failure: unknown
  for (const candidate of machineCandidates(config)) {
    try {
      const machine = await discoverAt(candidate)
      if (machine) return { machine, config: candidate }
    } catch (cause) {
      failure ??= cause
    }
  }
  if (failure !== undefined) throw failure
  return null
}
