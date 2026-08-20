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
 * Non-conversational parts such as files do not erase an otherwise valid final answer.
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
    if (part.type !== "reasoning" && part.type !== "tool") continue
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

/**
 * Recover the terminal answer for a particular Task run from a Session that may have been continued
 * manually afterwards. The matching user prompt is the turn boundary, so later Session-only work
 * cannot become the Task's result summary.
 */
export function assistantTerminalTextForPrompt(messages: MessageEnvelope[], prompt: string): string {
  const expected = prompt.trim()
  if (!expected) return ""

  for (let userIndex = messages.length - 1; userIndex >= 0; userIndex -= 1) {
    const user = messages[userIndex]
    if (user.info.role !== "user" || messageText(user) !== expected) continue

    let latest = ""
    for (let index = userIndex + 1; index < messages.length; index += 1) {
      const message = messages[index]
      if (message.info.role === "user") break
      if (message.info.role !== "assistant") continue
      const text = terminalMessageText(message)
      if (text) latest = text
    }
    return latest
  }

  return ""
}
