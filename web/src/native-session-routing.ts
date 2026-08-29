import { api, type NativeSessionLinkRecord } from "./api"
import type { AttachmentPart } from "./attachments"
import {
  nativeSessionSurfaceTarget,
  type NativeSessionHistoryEntry,
  type NativeSessionRecord,
  type NativeSessionRef,
  type NativeSessionSurfaceTarget
} from "./native-session-discovery"
import { handoffNativeSession } from "./native-session-handoff"
import { sendNativeSessionPrompt } from "./native-session-prompt"
import type { MachineAgentHost, ModelSelection, ServerConfig } from "./types"

export type NativeSessionRouteMachine = {
  machineID: string
  label: string
  config: ServerConfig
  agents: MachineAgentHost[]
}

export type NativeSessionRouteContinueInput = {
  machineID: string
  agentID: string
  prompt: string
  attachments: AttachmentPart[]
  model: ModelSelection | null
}

type PendingRouteContinue = {
  clientRequestId: string
  machineID: string
  agentID: string
  prompt: string
  model: ModelSelection | null
  attachmentKeys: string[]
  createdAt: number
  target?: NativeSessionRef
  link?: NativeSessionLinkRecord
}

const STORAGE_PREFIX = "harness-remote.native-session-route-continue.v1"

function transactionKey(source: NativeSessionSurfaceTarget): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(source.machineID)}:${encodeURIComponent(source.agentID)}:${encodeURIComponent(source.sessionID)}`
}

function requestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function machineConfig(config: ServerConfig): ServerConfig {
  return { ...config, agentId: undefined }
}

function attachmentKeys(attachments: AttachmentPart[]): string[] {
  return attachments.map((attachment) => [
    attachment.mime,
    attachment.filename,
    String(attachment.url.length),
    attachment.url.slice(-96)
  ].join("\u0000"))
}

function sameAttachments(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameModel(left: ModelSelection | null, right: ModelSelection | null): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.providerID === right.providerID && left.modelID === right.modelID && (left.variant || "") === (right.variant || "")
}

function loadPending(source: NativeSessionSurfaceTarget): PendingRouteContinue | null {
  try {
    const raw = localStorage.getItem(transactionKey(source))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingRouteContinue>
    if (!parsed.clientRequestId || !parsed.machineID || !parsed.agentID || typeof parsed.prompt !== "string") return null
    return {
      clientRequestId: parsed.clientRequestId,
      machineID: parsed.machineID,
      agentID: parsed.agentID,
      prompt: parsed.prompt,
      model: parsed.model && parsed.model.providerID && parsed.model.modelID ? parsed.model : null,
      attachmentKeys: Array.isArray(parsed.attachmentKeys) ? parsed.attachmentKeys.filter((value): value is string => typeof value === "string") : [],
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      target: parsed.target,
      link: parsed.link
    }
  } catch {
    return null
  }
}

function persistPending(source: NativeSessionSurfaceTarget, pending: PendingRouteContinue) {
  try { localStorage.setItem(transactionKey(source), JSON.stringify(pending)) } catch {}
}

function clearPending(source: NativeSessionSurfaceTarget) {
  try { localStorage.removeItem(transactionKey(source)) } catch {}
}

function historyEntry(source: NativeSessionSurfaceTarget, messages: NativeSessionHistoryEntry["messages"]): NativeSessionHistoryEntry {
  return {
    ref: source.ref,
    title: source.title,
    agentID: source.agentID,
    agentLabel: source.agentLabel,
    backend: source.backend,
    messages
  }
}

function targetRecord(source: NativeSessionSurfaceTarget, ref: NativeSessionRef, agent: MachineAgentHost): NativeSessionRecord {
  const now = Date.now()
  return {
    key: `${agent.id}:${ref.sessionID}`,
    agentId: agent.id,
    agentLabel: agent.label || agent.id,
    backend: agent.backend === "omp" || agent.backend === "pi" || agent.backend === "claude" || agent.backend === "codex"
      ? agent.backend
      : "opencode",
    transport: agent.transport,
    stopCapability: agent.contract?.sessions?.stop,
    abortSupported: agent.capabilities?.abort === true,
    modelsSupported: agent.capabilities?.models === true,
    commandsSupported: agent.capabilities?.commands === true,
    renameSupported: agent.capabilities?.sessionRename === true,
    deleteSupported: agent.capabilities?.sessionDelete === true,
    writerOwned: true,
    session: {
      id: ref.sessionID,
      title: source.title,
      directory: ref.directory,
      time: { created: now, updated: now },
      external: false
    }
  }
}

/**
 * Route one user turn to another machine/harness without retargeting the source Session.
 *
 * Selection itself is inert. This function only runs at Send time, creates one linked real native
 * Session idempotently, mirrors cross-machine lineage onto the source daemon, then sends the user's
 * first turn with the bounded inherited context packet. If either network response is lost, the
 * persisted transaction reuses the exact same target Session and prompt request on retry.
 */
export async function continueNativeSessionOnRoute({
  source,
  targetMachine,
  targetAgent,
  prompt,
  attachments,
  model
}: {
  source: NativeSessionSurfaceTarget
  targetMachine: NativeSessionRouteMachine
  targetAgent: MachineAgentHost
  prompt: string
  attachments: AttachmentPart[]
  model: ModelSelection | null
}): Promise<NativeSessionSurfaceTarget> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error("A text prompt is required")
  const keys = attachmentKeys(attachments)
  const existing = loadPending(source)
  if (existing && (
    existing.machineID !== targetMachine.machineID
    || existing.agentID !== targetAgent.id
    || existing.prompt !== normalizedPrompt
    || !sameModel(existing.model, model)
    || !sameAttachments(existing.attachmentKeys, keys)
  )) {
    throw new Error("A routed continuation is still unresolved. Retry the same machine, harness, model and prompt before choosing another destination.")
  }

  let pending: PendingRouteContinue = existing ?? {
    clientRequestId: requestID(),
    machineID: targetMachine.machineID,
    agentID: targetAgent.id,
    prompt: normalizedPrompt,
    model,
    attachmentKeys: keys,
    createdAt: Date.now()
  }
  persistPending(source, pending)

  if (!pending.target) {
    if (targetMachine.machineID === source.machineID) {
      const result = await handoffNativeSession(source, targetAgent.id, source.title, model)
      if (result.status !== "accepted" || !result.result?.target) {
        throw new Error("The linked Session has not been confirmed yet. Retry the same destination to reconcile it.")
      }
      pending = {
        ...pending,
        target: result.result.target,
        link: result.result.link as NativeSessionLinkRecord | undefined
      }
    } else {
      const result = await api.createRemoteSessionHandoff(machineConfig(targetMachine.config), {
        clientRequestId: pending.clientRequestId,
        source: source.ref,
        directory: source.directory,
        targetAgentID: targetAgent.id,
        title: source.title,
        model
      })
      if (result.status !== "accepted" || !result.result?.target || !result.result.link) {
        throw new Error("The remote linked Session has not been confirmed yet. Retry the same destination to reconcile it.")
      }
      pending = { ...pending, target: result.result.target, link: result.result.link }
    }
    persistPending(source, pending)
  }

  if (!pending.target) throw new Error("The linked Session identity is unavailable")

  // The target daemon stores the edge while creating the Session. Mirror that same edge on the
  // source daemon so opening either endpoint after a restart can navigate the chain.
  if (pending.target.machineID !== source.machineID && pending.link) {
    await api.registerNativeSessionLink(machineConfig(source.config), pending.link)
  }

  const page = await api.loadMessagePage(source.config, source.sessionID, source.directory, undefined, 100, false)
  const next = nativeSessionSurfaceTarget(
    pending.target.machineID,
    targetMachine.config,
    targetRecord(source, pending.target, targetAgent)
  )
  const routedTarget: NativeSessionSurfaceTarget = {
    ...next,
    history: [...(source.history || []), historyEntry(source, page.messages)],
    handoffContextPending: true,
    requiresExplicitClaim: false
  }

  const sent = await sendNativeSessionPrompt(routedTarget, normalizedPrompt, model, attachments)
  if (sent.status !== "accepted") {
    throw new Error("The linked Session exists, but delivery of its first prompt is not confirmed. Retry the same destination and prompt to reconcile it.")
  }

  clearPending(source)
  return routedTarget
}
