import type { MessagePart } from "./types"

export type ConversationPartGroup =
  | { kind: "content"; parts: MessagePart[] }
  | { kind: "activity"; parts: MessagePart[]; status: "running" | "completed" | "error" }

export function isConversationActivityPart(part: MessagePart): boolean {
  return part.type === "reasoning" || part.type === "tool"
}

function activityStatus(parts: MessagePart[]): "running" | "completed" | "error" {
  if (parts.some((part) => part.type === "tool" && part.state?.status === "error")) return "error"
  if (parts.some((part) => part.type === "tool" && part.state?.status && part.state.status !== "completed")) return "running"
  return "completed"
}

/**
 * Preserve the harness wire order while collapsing contiguous technical chatter into Activity.
 * Text stays in the normal conversation. Reasoning and tool parts remain inspectable, but they do
 * not compete with the user/agent dialogue in the default view.
 */
export function groupConversationParts(parts: MessagePart[]): ConversationPartGroup[] {
  const groups: ConversationPartGroup[] = []

  for (const part of parts) {
    const kind = isConversationActivityPart(part) ? "activity" : "content"
    const previous = groups[groups.length - 1]

    if (previous?.kind === kind) {
      previous.parts.push(part)
      if (previous.kind === "activity") previous.status = activityStatus(previous.parts)
      continue
    }

    if (kind === "activity") {
      groups.push({ kind, parts: [part], status: activityStatus([part]) })
    } else {
      groups.push({ kind, parts: [part] })
    }
  }

  return groups
}

export function activityLabel(group: Extract<ConversationPartGroup, { kind: "activity" }>): string {
  const toolCount = group.parts.filter((part) => part.type === "tool").length
  const hasReasoning = group.parts.some((part) => part.type === "reasoning")
  const detail = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
    hasReasoning ? "reasoning" : ""
  ].filter(Boolean).join(" · ")

  return detail ? `Activity · ${detail}` : "Activity"
}
