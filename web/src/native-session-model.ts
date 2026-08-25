import { api } from "./api"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"
import type { MessageEnvelope, ModelSelection } from "./types"

type NativeMessageInfo = MessageEnvelope["info"] & {
  model?: {
    providerID?: unknown
    modelID?: unknown
    id?: unknown
    variant?: unknown
  }
  providerID?: unknown
  modelID?: unknown
  variant?: unknown
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function userMessageModel(info: NativeMessageInfo): ModelSelection | null {
  const providerID = text(info.model?.providerID)
  const modelID = text(info.model?.modelID) ?? text(info.model?.id)
  if (!providerID || !modelID) return null
  const variant = text(info.model?.variant)
  return { providerID, modelID, ...(variant ? { variant } : {}) }
}

function assistantMessageModel(info: NativeMessageInfo): ModelSelection | null {
  const providerID = text(info.providerID)
  const modelID = text(info.modelID)
  if (!providerID || !modelID) return null
  const variant = text(info.variant)
  return { providerID, modelID, ...(variant ? { variant } : {}) }
}

/**
 * OpenCode keeps the model used for a turn in native message metadata rather than reliably exposing
 * it on the Session list item. Prefer the most recent user turn because that is the requested model
 * and carries the effort/variant; use assistant metadata only as a compatibility fallback.
 */
export function lastNativeMessageModel(messages: MessageEnvelope[]): ModelSelection | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info?.role !== "user") continue
    const model = userMessageModel(message.info as NativeMessageInfo)
    if (model) return model
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info as NativeMessageInfo | undefined
    if (!info) continue
    const model = assistantMessageModel(info)
    if (model) return model
  }

  return null
}

const PAGE_MODEL_BACKENDS = new Set(["omp", "pi", "codex", "claude"])

/**
 * Recover the last model from native Session state without persisting a second Harness Remote model.
 *
 * OpenCode stores the requested model on message metadata. OMP and PI report the model selected on
 * their exact native JSONL branch, Codex reports it from the newest rollout turn_context, and Claude
 * can report the current ACP model option from the same session/load already required to read its
 * transcript. None of these reads exists solely to claim writer ownership. If a harness cannot prove
 * a current model, leave it unset and let its own native default win rather than resurrecting stale
 * browser state.
 */
export async function resolveNativeSessionTargetModel(
  target: NativeSessionSurfaceTarget
): Promise<NativeSessionSurfaceTarget> {
  if (target.backend !== "opencode" && !PAGE_MODEL_BACKENDS.has(target.backend)) return target
  try {
    const page = await api.loadMessagePage(
      target.config,
      target.sessionID,
      target.directory,
      undefined,
      20,
      false
    )
    const model = page.model ?? (target.backend === "opencode" ? lastNativeMessageModel(page.messages) : null)
    return model ? { ...target, model } : target
  } catch {
    return target
  }
}
