import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { MessageEnvelope, MessagePart } from "../types"

const REMARK_PLUGINS = [remarkGfm]

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
            <div className="uw-markdown td3-markdown" key={part.id}>
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
              <div className="uw-markdown td3-markdown">
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
