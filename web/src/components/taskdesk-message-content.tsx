import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { activityLabel, groupConversationParts, type ConversationPartGroup } from "../conversation-parts"
import type { MessageEnvelope, MessagePart } from "../types"

const REMARK_PLUGINS = [remarkGfm]
type ActivityGroupValue = Extract<ConversationPartGroup, { kind: "activity" }>

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
  const [open, setOpen] = useState(status === "error")

  useEffect(() => {
    if (status === "error") setOpen(true)
  }, [status])

  return (
    <div className="uw-tool-stack">
      <details
        className={`uw-tool-card uw-tool-${status}`}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="uw-tool-icon">{status === "completed" ? "✓" : status === "error" ? "!" : "⋯"}</span>
          <span className="uw-tool-title">{state?.title || part.tool || "Tool"}</span>
          {command ? <code>{command.length > 90 ? `${command.slice(0, 90)}…` : command}</code> : null}
          <span className="uw-tool-status">{status}</span>
        </summary>
        {open && output ? <pre>{output.length > 4_000 ? `${output.slice(0, 4_000)}\n…` : output}</pre> : null}
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
  if ((part.type === "reasoning" || part.type === "text") && part.text) {
    return (
      <div className={`uw-reasoning${part.type === "text" ? " uw-working-note" : ""}`}>
        <strong>{part.type === "reasoning" ? "Reasoning" : "Working note"}</strong>
        <div className="uw-markdown td3-markdown">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{part.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (part.type === "tool") return <ToolPartCard part={part} />
  return null
}

function ActivityGroup({ group }: { group: ActivityGroupValue }) {
  const [open, setOpen] = useState(group.status === "error")

  useEffect(() => {
    if (group.status === "error") setOpen(true)
  }, [group.status])

  return (
    <details
      className={`uw-tool-card uw-activity-group uw-tool-${group.status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="uw-tool-icon">{group.status === "completed" ? "✓" : group.status === "error" ? "!" : "⋯"}</span>
        <span className="uw-tool-title">{activityLabel(group)}</span>
        <span className="uw-tool-status">{group.status}</span>
      </summary>
      {open ? (
        <div className="uw-activity-parts">
          {group.parts.map((part) => <ActivityPart key={part.id} part={part} />)}
        </div>
      ) : null}
    </details>
  )
}

function readableErrorValue(value: unknown, depth = 0): string {
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

function messageErrorText(message: MessageEnvelope): string {
  const error = message.info.error
  if (!error) return ""
  return readableErrorValue(error.data?.message) || readableErrorValue(error.message) || error.name || "The coding agent failed to complete this turn."
}

/**
 * Render the harness payload in native wire order while keeping the normal conversation readable.
 * Reasoning, tools and interstitial working narration stay inside Activity; only terminal assistant
 * text is normal dialogue. Collapsed Activity and tool bodies are not mounted at all, so long
 * reasoning/tool transcripts do not make scrolling expensive while hidden. Native turn failures
 * are rendered with the message itself so the reason remains visible after refresh or reopening.
 */
export function TaskDeskMessageContent({ message }: { message: MessageEnvelope }) {
  const groups = groupConversationParts(message.parts)
  const turnError = messageErrorText(message)

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

        return <ActivityGroup group={group} key={key} />
      })}
      {turnError ? <div className="uw-message-turn-error" role="alert"><strong>Turn failed</strong><span>{turnError}</span></div> : null}
    </div>
  )
}
