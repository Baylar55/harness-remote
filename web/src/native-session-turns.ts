import type { MessageEnvelope, MessagePart } from "./types"

type NativeTurn = {
  user: MessageEnvelope | null
  messages: MessageEnvelope[]
}

function textParts(parts: MessagePart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function canonicalText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim()
}

/**
 * Compatibility with the mature v3 cross-agent transport packet. The packet is context for the
 * target harness, not a second user message. If one appears in native history, show only the actual
 * user instruction just as WorkThreadConversation does.
 */
function visibleUserText(text: string): string {
  const value = canonicalText(text)
  if (!value.startsWith("You are taking over an existing TaskDesk task.")) return value
  const marker = "\nUSER INSTRUCTION\n"
  const start = value.indexOf(marker)
  if (start < 0) return value
  const instructionStart = start + marker.length
  const footer = "\n\nContinue from the shared workspace and the transferred Task Context."
  const end = value.indexOf(footer, instructionStart)
  return canonicalText(value.slice(instructionStart, end >= 0 ? end : undefined))
}

/** Native user messages are the only turn boundary, matching the stabilized v3 timeline. */
function nativeTurns(messages: MessageEnvelope[]): NativeTurn[] {
  const turns: NativeTurn[] = []
  let current: NativeTurn | null = null

  for (const message of messages) {
    if (message.info.role === "user") {
      if (current) turns.push(current)
      current = { user: message, messages: [message] }
      continue
    }
    if (!current) current = { user: null, messages: [] }
    current.messages.push(message)
  }
  if (current) turns.push(current)
  return turns
}

/**
 * This is intentionally the same aggregation rule used by v3 WorkThreadConversation:
 * - native message identity prevents the same envelope being applied twice;
 * - all assistant envelopes inside one native user turn become one logical assistant turn;
 * - tool callID is protocol identity, so a later update replaces the earlier state in place.
 */
function assistantParts(messages: MessageEnvelope[], aggregateID: string): MessagePart[] {
  const parts: MessagePart[] = []
  const seenMessages = new Set<string>()
  const toolIndexes = new Map<string, number>()

  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    const messageIdentity = `${message.info.sessionID}:${message.info.id}`
    if (seenMessages.has(messageIdentity)) continue
    seenMessages.add(messageIdentity)

    for (const raw of message.parts ?? []) {
      const part: MessagePart = {
        ...raw,
        id: `${message.info.id}:${raw.id}`,
        messageID: aggregateID
      }
      if (part.type === "tool" && part.callID) {
        const prior = toolIndexes.get(part.callID)
        if (prior !== undefined) {
          parts[prior] = { ...part, id: parts[prior].id }
          continue
        }
        toolIndexes.set(part.callID, parts.length)
      }
      parts.push(part)
    }
  }
  return parts
}

function visibleUser(message: MessageEnvelope): MessageEnvelope {
  const text = visibleUserText(textParts(message.parts))
  if (!text) return message
  const textPartsOnly = message.parts.filter((part) => part.type === "text")
  if (textPartsOnly.length === 1 && textPartsOnly[0].text === text) return message
  const firstText = textPartsOnly[0]
  const replacement: MessagePart = firstText
    ? { ...firstText, text }
    : { id: `${message.info.id}:visible-text`, messageID: message.info.id, type: "text", text }
  return {
    ...message,
    parts: [replacement, ...message.parts.filter((part) => part.type !== "text")]
  }
}

function logicalAssistant(turn: NativeTurn, index: number): MessageEnvelope | null {
  const assistants = turn.messages.filter((message) => message.info.role === "assistant")
  if (!assistants.length) return null
  const first = assistants[0]
  const last = assistants[assistants.length - 1]
  const turnIdentity = turn.user?.info.id || first.info.id || String(index)
  const id = `${first.info.sessionID}:logical-turn:${turnIdentity}:assistant`
  const error = [...assistants].reverse().find((message) => message.info.error)?.info.error
  return {
    info: {
      ...first.info,
      id,
      role: "assistant",
      time: {
        created: first.info.time.created,
        ...(last.info.time.completed ? { completed: last.info.time.completed } : {})
      },
      ...(error ? { error } : {})
    },
    parts: assistantParts(assistants, id)
  }
}

/**
 * Convert a native transcript into the same user-facing logical turn shape that mature v3 used.
 * No timestamp windows and no text-equality dedupe are used. Distinct native user turns remain
 * distinct, while protocol update envelopes belonging to one turn stop becoming separate chat rows.
 */
export function normalizeNativeSessionTurns(messages: MessageEnvelope[]): MessageEnvelope[] {
  const result: MessageEnvelope[] = []
  nativeTurns(messages).forEach((turn, index) => {
    if (turn.user) result.push(visibleUser(turn.user))
    const assistant = logicalAssistant(turn, index)
    if (assistant) result.push(assistant)
  })
  return result
}
