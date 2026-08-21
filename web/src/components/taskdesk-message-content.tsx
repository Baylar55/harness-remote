import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { activityLabel, groupConversationParts } from "../conversation-parts"
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

function TextPart({ part }: { part: MessagePart }) {
  if (part.type !== "text" || !part.text) return null
  return (
    <div className="uw-markdown td3-markdown">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{part.text}</ReactMarkdown>
    </div>
  )
}

function ActivityPart({ part }: { part: MessagePart }) {
  if (part.type === "reasoning" && part.text) {
    return (
      <div className="uw-reasoning">
        <strong>Reasoning</strong>
        <div className="uw-markdown td3-markdown">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{part.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (part.type === "tool") return <ToolPartCard part={part} />
  return null
}

/**
 * Render the harness payload in native wire order while keeping the normal conversation readable.
 * Reasoning and tool chatter is preserved exactly where it occurred, but contiguous technical parts
 * are collapsed into one Activity disclosure by default.
 */
export function TaskDeskMessageContent({ message }: { message: MessageEnvelope }) {
  const groups = groupConversationParts(message.parts)

  return (
    <div className="uw-message-parts">
      {groups.map((group, groupIndex) => {
        const key = group.parts[0]?.id || `${message.info.id}:${groupIndex}`
        if (group.kind === "content") {
          return (
            <div className="uw-message-content-group" key={key}>
              {group.parts.map((part) => <TextPart key={part.id} part={part} />)}
            </div>
          )
        }

        return (
          <details className={`uw-tool-card uw-activity-group uw-tool-${group.status}`} key={key}>
            <summary>
              <span className="uw-tool-icon">{group.status === "completed" ? "✓" : group.status === "error" ? "!" : "⋯"}</span>
              <span className="uw-tool-title">{activityLabel(group)}</span>
              <span className="uw-tool-status">{group.status}</span>
            </summary>
            <div className="uw-activity-parts">
              {group.parts.map((part) => <ActivityPart key={part.id} part={part} />)}
            </div>
          </details>
        )
      })}
    </div>
  )
}
