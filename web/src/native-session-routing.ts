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
import {
  loadPendingNativeSessionPrompt,
  nativeSessionTransferredContext,
  sendNativeSessionPrompt
} from "./native-session-prompt"
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
  agentID: string
  prompt: string
  model: ModelSelection | null
  createdAt: number
  target: NativeSessionRef
  link?: NativeSessionLinkRecord
}

const STORAGE_PREFIX = "harness-remote.native-session-route-continue.v1"
const PENDING_ROUTE_TTL_MS = 10 * 60 * 1000

function transactionKey(source: NativeSessionSurfaceTarget): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(source.machineID)}:${encodeURIComponent(source.agentID)}:${encodeURIComponent(source.sessionID)}`
}

function machineConfig(config: ServerConfig): ServerConfig {
  return { ...config, agentId: undefined }
}

function sameModel(left: ModelSelection | null, right: ModelSelection | null): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.providerID === right.providerID
    && left.modelID === right.modelID
    && (left.variant || "") === (right.variant || "")
}

export function clearPendingNativeSessionRoute(source: NativeSessionSurfaceTarget) {
  try { localStorage.removeItem(transactionKey(source)) } catch {}
}

function loadPending(source: NativeSessionSurfaceTarget): PendingRouteContinue | null {
  try {
    const raw = localStorage.getItem(transactionKey(source))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingRouteContinue>
    if (
      !parsed.target
      || !parsed.target.machineID
      || !parsed.target.agentID
      || !parsed.target.sessionID
      || !parsed.target.directory
      || typeof parsed.agentID !== "string"
      || typeof parsed.prompt !== "string"
    ) {
      clearPendingNativeSessionRoute(source)
      return null
    }
    const pending: PendingRouteContinue = {
      agentID: parsed.agentID,
      prompt: parsed.prompt,
      model: parsed.model && parsed.model.providerID && parsed.model.modelID ? parsed.model : null,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      target: parsed.target,
      link: parsed.link
    }
    if (Date.now() - pending.createdAt > PENDING_ROUTE_TTL_MS) {
      clearPendingNativeSessionRoute(source)
      return null
    }
    return pending
  } catch {
    clearPendingNativeSessionRoute(source)
    return null
  }
}

function persistPending(source: NativeSessionSurfaceTarget, pending: PendingRouteContinue) {
  try { localStorage.setItem(transactionKey(source), JSON.stringify(pending)) } catch {}
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
 * Continue one native Session on another harness of the same machine.
 *
 * Machine changes are deliberately outside this protocol for now. The harness handoff itself owns
 * resource-creation idempotency. Once a target Session is confirmed, this small transaction retains
 * only enough information to retry an uncertain first prompt against that exact target. It expires
 * on the same ten-minute horizon as normal native prompt recovery and is cleared on definite prompt
 * rejection, so one failed handoff cannot permanently brick future routing.
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
  if (targetMachine.machineID !== source.machineID) {
    throw new Error("Continuing on another machine is not available yet.")
  }
  if (attachments.length) {
    throw new Error("Remove images before continuing on another harness. Attachments remain scoped to the current Session for now.")
  }

  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error("A text prompt is required")

  let pending = loadPending(source)
  if (pending && (
    pending.agentID !== targetAgent.id
    || pending.prompt !== normalizedPrompt
    || !sameModel(pending.model, model)
  )) {
    throw new Error("A routed continuation is still unresolved. Retry the same harness, model and prompt, or try again after the recovery window expires.")
  }

  if (!pending) {
    const result = await handoffNativeSession(source, targetAgent.id, source.title, model)
    if (result.status !== "accepted" || !result.result?.target) {
      throw new Error("The linked Session has not been confirmed yet. Retry the same harness and model to reconcile it.")
    }
    pending = {
      agentID: targetAgent.id,
      prompt: normalizedPrompt,
      model,
      createdAt: Date.now(),
      target: result.result.target,
      link: result.result.link as NativeSessionLinkRecord | undefined
    }
    persistPending(source, pending)
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

  const transferredContext = nativeSessionTransferredContext(routedTarget)
  if (pending.link && transferredContext) {
    try {
      const persisted = await api.registerNativeSessionLink(machineConfig(source.config), {
        ...pending.link,
        transferredContext
      })
      pending = { ...pending, link: persisted.link }
      persistPending(source, pending)
    } catch {
      // The native link itself was already durably created by the handoff. Context persistence is
      // enrichment and must not turn an otherwise valid local handoff into a blocked mutation.
    }
  }

  try {
    const sent = await sendNativeSessionPrompt(routedTarget, normalizedPrompt, model, [])
    if (sent.status !== "accepted") {
      throw new Error("The linked Session exists, but delivery of its first prompt is not confirmed. Retry the same harness and prompt to reconcile it.")
    }
    clearPendingNativeSessionRoute(source)
    return routedTarget
  } catch (error) {
    // A 4xx rejection clears the target Session prompt record. In that case there is nothing left to
    // reconcile, so free the source routing transaction immediately. Network/5xx uncertainty keeps
    // both records until retry or TTL expiry and therefore preserves the no-duplicate guarantee.
    if (!loadPendingNativeSessionPrompt(routedTarget)) clearPendingNativeSessionRoute(source)
    throw error
  }
}
