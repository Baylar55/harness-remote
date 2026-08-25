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

/**
 * Enrich only the Session the user opened. Home discovery remains transcript-free and read-only.
 * The recent tail is enough to recover OpenCode's last requested model without persisting a second
 * Session state in Harness Remote.
 */
export async function resolveNativeSessionTargetModel(
  target: NativeSessionSurfaceTarget
): Promise<NativeSessionSurfaceTarget> {
  if (target.backend !== "opencode") return target
  try {
    const page = await api.loadMessagePage(
      target.config,
      target.sessionID,
      target.directory,
      undefined,
      20,
      false
    )
    const model = lastNativeMessageModel(page.messages)
    return model ? { ...target, model } : target
  } catch {
    return target
  }
}
