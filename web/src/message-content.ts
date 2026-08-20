import type { MessageEnvelope } from "./types"

export function messageText(message: MessageEnvelope): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

/**
 * Return only the natural-language answer emitted after the last reasoning/tool activity in a
 * native message. Some ACP harnesses keep narration, reasoning, tool calls and the final answer in
 * one message, so concatenating every text part puts pre-tool narration into the Task result.
 */
export function terminalMessageText(message: MessageEnvelope): string {
  const chunks: string[] = []
  let foundText = false

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index]
    if (part.type === "text") {
      const text = typeof part.text === "string" ? part.text.trim() : ""
      if (!text) continue
      chunks.push(part.text || "")
      foundText = true
      continue
    }
    if (foundText) break
    return ""
  }

  return chunks.reverse().join("\n").trim()
}

/** Never cross the latest user turn when looking for the result of the current turn. */
export function latestAssistantTerminalText(messages: MessageEnvelope[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.info.role === "user") break
    if (message.info.role !== "assistant") continue
    const text = terminalMessageText(message)
    if (text) return text
  }
  return ""
}
