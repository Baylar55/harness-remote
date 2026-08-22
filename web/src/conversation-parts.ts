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
 * Preserve native wire order while collapsing technical chatter into Activity.
 *
 * Some ACP harnesses emit short assistant text while they are still reasoning and then continue
 * with more tools/reasoning. Such interstitial narration is not a terminal answer, so keep it inside
 * Activity when it sits between technical parts. Text before the first Activity can remain ordinary
 * narration and text after the last Activity is the final visible answer.
 */
export function groupConversationParts(parts: MessagePart[]): ConversationPartGroup[] {
  const groups: ConversationPartGroup[] = []
  const activityIndexes = parts.flatMap((part, index) => isConversationActivityPart(part) ? [index] : [])
  const firstActivity = activityIndexes[0] ?? -1
  const lastActivity = activityIndexes.length ? activityIndexes[activityIndexes.length - 1] : -1

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const interstitialText = part.type === "text" && firstActivity >= 0 && index > firstActivity && index < lastActivity
    const kind = isConversationActivityPart(part) || interstitialText ? "activity" : "content"
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
  const hasWorkingNotes = group.parts.some((part) => part.type === "text")
  const detail = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
    hasReasoning ? "reasoning" : "",
    hasWorkingNotes ? "working notes" : ""
  ].filter(Boolean).join(" · ")

  return detail ? `Activity · ${detail}` : "Activity"
}
