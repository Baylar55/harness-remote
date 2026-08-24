import type { MessageEnvelope, MessagePart } from "./types"

const INTERNAL_PROTOCOL_PARTS = new Set(["step-start", "step-finish", "snapshot", "patch"])

export type ConversationTurnAttention = {
  kind: "failed" | "interrupted"
  title: "Turn failed" | "Response interrupted"
  message: string
}

export function isInternalProtocolPart(part: MessagePart): boolean {
  return INTERNAL_PROTOCOL_PARTS.has(part.type)
}

export function hasTerminalAssistantText(parts: MessagePart[]): boolean {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (isInternalProtocolPart(part)) continue
    if (part.type === "text") {
      if (typeof part.text === "string" && part.text.trim()) return true
      continue
    }
    if (part.type === "reasoning" || part.type === "tool") return false
  }
  return false
}

export function readableErrorValue(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return ""
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return ""
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        const nested = readableErrorValue(JSON.parse(text), depth + 1)
        if (nested) return nested
      } catch {
        // A provider error is often plain text that happens to begin with punctuation.
      }
    }
    return text
  }
  if (typeof value !== "object") return ""
  const record = value as Record<string, unknown>
  for (const key of ["message", "error", "detail", "data"]) {
    const text = readableErrorValue(record[key], depth + 1)
    if (text) return text
  }
  return ""
}

export function messageErrorText(message: MessageEnvelope): string {
  const error = message.info.error
  if (!error) return ""
  return readableErrorValue(error.data?.message)
    || readableErrorValue(error.message)
    || error.name
    || "The coding agent failed to complete this turn."
}

/**
 * Derive the user-visible terminal state for one assistant turn without coupling it to a renderer.
 * A final assistant answer wins over stale transport/intermediate errors. Tool/reasoning activity
 * without a final answer is interrupted only after the Session is no longer active.
 */
export function assistantTurnAttention(
  message: MessageEnvelope,
  { active = false }: { active?: boolean } = {}
): ConversationTurnAttention | null {
  if (message.info.role !== "assistant" || active) return null
  if (hasTerminalAssistantText(message.parts)) return null

  const turnError = messageErrorText(message)
  if (turnError) return { kind: "failed", title: "Turn failed", message: turnError }

  const hasActivity = message.parts.some((part) => {
    if (isInternalProtocolPart(part)) return false
    return part.type === "reasoning" || part.type === "tool"
  })
  if (!hasActivity) return null
  return {
    kind: "interrupted",
    title: "Response interrupted",
    message: "The coding agent stopped before producing a final answer."
  }
}

/**
 * Inspect only the latest logical user turn. This is intentionally cheap and is meant for an open
 * Session whose transcript is already loaded; the Sessions Home must never fan out transcript reads
 * just to manufacture attention badges.
 */
export function latestConversationAttention(
  messages: MessageEnvelope[],
  { active = false }: { active?: boolean } = {}
): ConversationTurnAttention | null {
  if (active) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.info.role === "user") break
    if (message.info.role !== "assistant") continue
    if (hasTerminalAssistantText(message.parts)) return null
    const attention = assistantTurnAttention(message)
    if (attention) return attention
  }
  return null
}
