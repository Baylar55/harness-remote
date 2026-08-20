import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { MessageEnvelope, MessagePart } from "../types"

const REMARK_PLUGINS = [remarkGfm]

export function messageText(message: MessageEnvelope): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

/**
 * Return only the natural-language answer that occurs after the last reasoning/tool activity in a
 * message. ACP harnesses such as Claude can keep narration, reasoning, tool calls and the final
 * answer in one native message. Flattening every text part makes the final answer look as though it
 * happened before the tools and also pollutes Task outcome summaries with pre-tool narration.
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
    // The message ended in tool/reasoning activity and never emitted a final natural-language
    // answer. Do not promote narration from before that activity to a completed Task result.
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

function ToolPartCard({ part }: { part: MessagePart }) {
  const state = part.state
  const status = state?.status || "running"
  const input = state?.input || {}
  const command = typeof input.command === "string"
    ? input.command
    : typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : ""
  const output = state?.error || state?.output || ""

  return (
    <div className="uw-tool-stack">
      <details className={`uw-tool-card uw-tool-${status}`} open={status === "error"}>
        <summary>
          <span className="uw-tool-icon">{status === "completed" ? "✓" : status === "error" ? "!" : "⋯"}</span>
          <span className="uw-tool-title">{state?.title || part.tool || "Tool"}</span>
          {command ? <code>{command.length > 90 ? `${command.slice(0, 90)}…` : command}</code> : null}
          <span className="uw-tool-status">{status}</span>
        </summary>
        {output ? <pre>{output.length > 4_000 ? `${output.slice(0, 4_000)}\n…` : output}</pre> : null}
      </details>
    </div>
  )
}

/** Render the harness payload in wire order instead of regrouping it by part type. */
export function TaskDeskMessageContent({ message }: { message: MessageEnvelope }) {
  return (
    <div className="uw-message-parts">
      {message.parts.map((part) => {
        if (part.type === "text" && part.text) {
          return (
            <div className="uw-markdown" key={part.id}>
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{part.text}</ReactMarkdown>
            </div>
          )
        }
        if (part.type === "reasoning" && part.text) {
          return (
            <details className="uw-tool-card uw-reasoning" key={part.id} open>
              <summary>
                <span className="uw-tool-icon">…</span>
                <span className="uw-tool-title">Reasoning</span>
              </summary>
              <div className="uw-markdown">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{part.text}</ReactMarkdown>
              </div>
            </details>
          )
        }
        if (part.type === "tool") return <ToolPartCard key={part.id} part={part} />
        return null
      })}
    </div>
  )
}
