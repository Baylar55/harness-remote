import { Capacitor, CapacitorHttp } from "@capacitor/core"
import { desktopRequestResult, isDesktopPlatform } from "./desktopBridge"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"
import { authHeader, baseUrl, hasCredentials, routingHeaders } from "./serverConfig"
import type { ModelSelection } from "./types"

export type NativeSessionPromptStatus = "accepted" | "pending" | "uncertain"

export type PendingNativeSessionPrompt = {
  clientRequestId: string
  text: string
  model?: ModelSelection | null
  createdAt: number
}

const STORAGE_PREFIX = "harness-remote.native-session-prompt.v1"

function storageKey(target: NativeSessionSurfaceTarget): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(target.machineID)}:${encodeURIComponent(target.agentID)}:${encodeURIComponent(target.sessionID)}`
}

function requestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function normalizeModel(value: unknown): ModelSelection | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<ModelSelection>
  const providerID = typeof candidate.providerID === "string" ? candidate.providerID.trim() : ""
  const modelID = typeof candidate.modelID === "string" ? candidate.modelID.trim() : ""
  if (!providerID || !modelID) return null
  const variant = typeof candidate.variant === "string" && candidate.variant.trim() ? candidate.variant.trim() : undefined
  return { providerID, modelID, ...(variant ? { variant } : {}) }
}

function sameModel(left?: ModelSelection | null, right?: ModelSelection | null): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.providerID === right.providerID && left.modelID === right.modelID && (left.variant || "") === (right.variant || "")
}

export function loadPendingNativeSessionPrompt(target: NativeSessionSurfaceTarget): PendingNativeSessionPrompt | null {
  try {
    const raw = localStorage.getItem(storageKey(target))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingNativeSessionPrompt>
    if (typeof parsed.clientRequestId !== "string" || !parsed.clientRequestId) return null
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null
    return {
      clientRequestId: parsed.clientRequestId,
      text: parsed.text,
      model: normalizeModel(parsed.model),
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now()
    }
  } catch {
    return null
  }
}

function persistPending(target: NativeSessionSurfaceTarget, pending: PendingNativeSessionPrompt) {
  try { localStorage.setItem(storageKey(target), JSON.stringify(pending)) } catch {}
}

export function clearPendingNativeSessionPrompt(target: NativeSessionSurfaceTarget) {
  try { localStorage.removeItem(storageKey(target)) } catch {}
}

function parseStatus(data: unknown): NativeSessionPromptStatus {
  if (data && typeof data === "object") {
    const value = (data as { status?: unknown }).status
    if (value === "accepted" || value === "pending" || value === "uncertain") return value
  }
  return "accepted"
}

function errorDetail(body: unknown, status: number): string {
  if (typeof body === "string") {
    try { return errorDetail(JSON.parse(body), status) }
    catch { return body || `HTTP ${status}` }
  }
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error
  }
  return `HTTP ${status}`
}

/**
 * Send one prompt to the exact existing native Session with a durable client request id.
 *
 * The pending id and its model selection are written on the client before network I/O. A retry of
 * the same semantic prompt therefore converges on the daemon ledger even after a lost HTTP response
 * or WebView reload. A changed prompt, model or effort is blocked while delivery is unresolved,
 * preserving turn order rather than guessing what the harness accepted.
 */
export async function sendNativeSessionPrompt(
  target: NativeSessionSurfaceTarget,
  text: string,
  model?: ModelSelection | null
): Promise<{ status: NativeSessionPromptStatus; clientRequestId: string }> {
  const normalized = text.trim()
  if (!normalized) throw new Error("A text prompt is required")
  const requestedModel = normalizeModel(model)

  const existing = loadPendingNativeSessionPrompt(target)
  if (existing && (existing.text !== normalized || !sameModel(existing.model, requestedModel))) {
    throw new Error("A previous prompt still has an unresolved delivery status. Retry that exact prompt and model selection before sending a different request.")
  }
  const pending = existing ?? {
    clientRequestId: requestID(),
    text: normalized,
    model: requestedModel,
    createdAt: Date.now()
  }
  persistPending(target, pending)

  const path = `/session/${encodeURIComponent(target.sessionID)}/prompt`
  const body = {
    clientRequestId: pending.clientRequestId,
    text: normalized,
    directory: target.directory,
    model: pending.model ? { providerID: pending.model.providerID, modelID: pending.model.modelID } : undefined,
    variant: pending.model?.variant || undefined
  }

  let status: NativeSessionPromptStatus
  if (isDesktopPlatform()) {
    const result = await desktopRequestResult(target.config, { path, method: "POST", body })
    if (!result.ok) throw new Error(result.error.message)
    status = parseStatus(result.response.data)
  } else {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...routingHeaders(target.config, { preflight: !Capacitor.isNativePlatform() })
    }
    if (hasCredentials(target.config)) headers.Authorization = authHeader(target.config)
    const url = `${baseUrl(target.config)}${path}`

    if (Capacitor.isNativePlatform()) {
      let response
      try {
        response = await CapacitorHttp.request({
          url,
          method: "POST",
          headers,
          data: body,
          connectTimeout: 12_000,
          readTimeout: 30_000
        })
      } catch {
        throw new Error(`Cannot reach ${target.config.host}:${target.config.port}. Prompt delivery status is unknown; retry will use the same request id.`)
      }
      if (response.status >= 400) throw new Error(errorDetail(response.data, response.status))
      status = parseStatus(response.data)
    } else {
      let response: Response
      try {
        response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
      } catch {
        throw new Error(`Cannot reach ${target.config.host}:${target.config.port}. Prompt delivery status is unknown; retry will use the same request id.`)
      }
      let data: unknown = undefined
      try {
        const raw = await response.text()
        data = raw ? JSON.parse(raw) : undefined
      } catch {}
      if (!response.ok) throw new Error(errorDetail(data, response.status))
      status = parseStatus(data)
    }
  }

  if (status === "accepted") clearPendingNativeSessionPrompt(target)
  return { status, clientRequestId: pending.clientRequestId }
}