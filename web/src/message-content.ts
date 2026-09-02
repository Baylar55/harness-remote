import type { MessageEnvelope } from "./types"

export function messageText(message: MessageEnvelope): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

function terminalAssistantText(messages: MessageEnvelope[], start: number, end: number): string {
  const chunks: string[] = []
  let foundText = false

  for (let messageIndex = end - 1; messageIndex >= start; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.info.role !== "assistant") continue

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part.type === "text") {
        const text = typeof part.text === "string" ? part.text.trim() : ""
        if (!text) continue
        chunks.push(part.text || "")
        foundText = true
        continue
      }
      if (part.type !== "reasoning" && part.type !== "tool") continue
      if (foundText) return chunks.reverse().join("\n").trim()
      return ""
    }
  }

  return chunks.reverse().join("\n").trim()
}

/**
 * Recover the terminal answer for a particular Task run from a Session that may have been continued
 * manually afterwards. The matching user prompt is the turn boundary, so later Session-only work
 * cannot become the Task's result summary. The scan covers the whole assistant turn because some
 * adapters split narration, tools and final text into separate native message envelopes.
 */
export function assistantTerminalTextForPrompt(messages: MessageEnvelope[], prompt: string): string {
  const expected = prompt.trim()
  if (!expected) return ""

  for (let userIndex = messages.length - 1; userIndex >= 0; userIndex -= 1) {
    const user = messages[userIndex]
    if (user.info.role !== "user" || messageText(user) !== expected) continue

    let end = messages.length
    for (let index = userIndex + 1; index < messages.length; index += 1) {
      if (messages[index].info.role === "user") {
        end = index
        break
      }
    }
    return terminalAssistantText(messages, userIndex + 1, end)
  }

  return ""
}
