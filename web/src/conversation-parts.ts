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
  if (parts.some((part) => part.type === "reasoning" && part.time?.start && !part.time.end)) return "running"
  return "completed"
}

/**
 * Preserve native wire order while keeping the visible conversation turn-based.
 *
 * If an assistant turn contains technical activity, every text fragment emitted before the final
 * reasoning/tool part is working narration, not a separate answer. Keep those fragments inside the
 * same Activity group. Only text after the final technical part becomes normal assistant dialogue.
 * A turn with no reasoning/tools remains ordinary visible content.
 */
export function groupConversationParts(parts: MessagePart[]): ConversationPartGroup[] {
  const groups: ConversationPartGroup[] = []
  const activityIndexes = parts.flatMap((part, index) => isConversationActivityPart(part) ? [index] : [])
  const lastActivity = activityIndexes.length ? activityIndexes[activityIndexes.length - 1] : -1

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const workingText = part.type === "text" && lastActivity >= 0 && index < lastActivity
    const kind = isConversationActivityPart(part) || workingText ? "activity" : "content"
    const previous = groups[groups.length - 1]

    if (previous?.kind === kind) {
      previous.parts.push(part)
      if (previous.kind === "activity") previous.status = activityStatus(previous.parts)
      continue
    }

    if (kind === "activity") groups.push({ kind, parts: [part], status: activityStatus([part]) })
    else groups.push({ kind, parts: [part] })
  }

  return groups
}

export function activityLabel(group: Extract<ConversationPartGroup, { kind: "activity" }>): string {
  const toolCount = group.parts.filter((part) => part.type === "tool").length
  const hasReasoning = group.parts.some((part) => part.type === "reasoning")
  const hasWorkingNotes = group.parts.some((part) => part.type === "text")
  const detail = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
    hasReasoning ? "reasoning" : "",
    hasWorkingNotes ? "working notes" : ""
  ].filter(Boolean).join(" · ")

  return detail ? `Activity · ${detail}` : "Activity"
}
