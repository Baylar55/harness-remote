import type { MachineTask, MachineTaskRun } from "./taskClient"
import type { MessageEnvelope, MessagePart } from "./types"

export type WorkThreadMessageMeta = {
  kind: "native" | "event" | "synthetic-user" | "fallback-result" | "error"
  agentId?: string
  agentLabel?: string
  agentBackend?: string
  runId?: string
}

export type WorkThreadMessage = MessageEnvelope & {
  taskdesk?: WorkThreadMessageMeta
}

export type WorkThreadAgentMeta = Record<string, { label: string; backend: string }>

function runsFor(task: MachineTask): MachineTaskRun[] {
  const runs = Array.isArray(task.runs) && task.runs.length ? task.runs : task.run ? [task.run] : []
  return [...runs].sort((left, right) => {
    const sequence = (Number(left.sequence) || 0) - (Number(right.sequence) || 0)
    if (sequence) return sequence
    return Date.parse(left.startedAt || "") - Date.parse(right.startedAt || "")
  })
}

export function workThreadRuns(task: MachineTask): MachineTaskRun[] {
  return runsFor(task)
}

export function runSessionID(run?: MachineTaskRun | null): string | null {
  return run?.sessionId || run?.sessionID || null
}

function textParts(parts: MessagePart[] | undefined): string {
  return (parts ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim()
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizedVisibleText(message: MessageEnvelope): string {
  return normalizedText(textParts(message.parts))
}

function isTaskDeskTransfer(text: string): boolean {
  return text.startsWith("You are taking over an existing TaskDesk task.")
    || (text.includes("The context below was transferred by TaskDesk") && text.includes("USER INSTRUCTION"))
}

function samePrompt(left: string, right: string): boolean {
  return Boolean(right.trim()) && normalizedText(left) === normalizedText(right)
}

function compactTextParts(parts: MessagePart[]): MessagePart[] {
  const compacted: MessagePart[] = []
  for (const part of parts) {
    const text = typeof part.text === "string" ? part.text.trim() : ""
    if (!text) continue
    const previous = compacted.length ? compacted[compacted.length - 1] : undefined
    const previousText = typeof previous?.text === "string" ? previous.text.trim() : ""
    const currentNormalized = normalizedText(text)
    const previousNormalized = normalizedText(previousText)

    // PI and some ACP adapters can journal a partial text chunk and later repeat the whole answer
    // after thinking. Keep the complete later form instead of showing the same answer twice.
    if (previous && previousNormalized && currentNormalized.startsWith(previousNormalized) && currentNormalized.length > previousNormalized.length) {
      compacted[compacted.length - 1] = part
      continue
    }
    if (previous && currentNormalized && previousNormalized.startsWith(currentNormalized)) continue
    if (previous && currentNormalized === previousNormalized) continue
    compacted.push(part)
  }
  return compacted
}

function compactAssistantParts(parts: MessagePart[]): MessagePart[] {
  const text = compactTextParts(parts.filter((part) => part.type === "text"))
  const nonText = parts.filter((part) => part.type !== "text")

  // Product chat keeps the answer after Activity, but the Activity itself stays in native order.
  // In particular, do not merge every reasoning fragment into the first one: OMP can interleave
  // reasoning and completed tools, and moving later reasoning above those tools made the expanded
  // disclosure look corrupted. Separate reasoning fragments are cheap because Activity is lazy.
  return [...nonText, ...text]
}

function compactAssistantMessage(message: MessageEnvelope): MessageEnvelope {
  if (message.info.role !== "assistant") return message
  return { ...message, parts: compactAssistantParts(message.parts) }
}

function syntheticMessage({
  id,
  role,
  sessionID,
  created,
  text,
  meta
}: {
  id: string
  role: string
  sessionID: string
  created: number
  text: string
  meta: WorkThreadMessageMeta
}): WorkThreadMessage {
  return {
    info: { id, role, sessionID, time: { created } },
    parts: [{ id: `${id}:text`, messageID: id, type: "text", text }],
    taskdesk: meta
  }
}

function runStart(task: MachineTask, run: MachineTaskRun, index: number): number {
  const parsed = Date.parse(run.startedAt || "")
  if (Number.isFinite(parsed)) return parsed
  const taskCreated = Date.parse(task.createdAt || "")
  return (Number.isFinite(taskCreated) ? taskCreated : Date.now()) + index * 10
}

function runEnd(run: MachineTaskRun, next: MachineTaskRun | undefined): number {
  const nextStart = Date.parse(next?.startedAt || "")
  if (Number.isFinite(nextStart)) return nextStart
  const finished = Date.parse(run.finishedAt || "")
  return Number.isFinite(finished) ? finished + 5_000 : Number.POSITIVE_INFINITY
}

function eventText(runs: MachineTaskRun[], index: number, agents: WorkThreadAgentMeta): string | null {
  if (index === 0) return null
  const run = runs[index]
  const previous = runs[index - 1]
  const currentAgent = run.agentId || ""
  const previousAgent = previous.agentId || ""
  if (!currentAgent || currentAgent === previousAgent) return null
  const label = agents[currentAgent]?.label || currentAgent
  const appearedBefore = runs.slice(0, index - 1).some((candidate) => candidate.agentId === currentAgent)
  return `${appearedBefore ? "Resumed" : "Switched to"} ${label} · context transferred`
}

function transcriptTurns(messages: MessageEnvelope[]): MessageEnvelope[][] {
  const turns: MessageEnvelope[][] = []
  let current: MessageEnvelope[] = []
  for (const message of messages) {
    if (message.info.role === "user") {
      if (current.length) turns.push(current)
      current = [message]
      continue
    }
    if (current.length) current.push(message)
    else if (turns.length) turns[turns.length - 1].push(message)
    else current = [message]
  }
  if (current.length) turns.push(current)
  return turns
}

/**
 * ACP replay notifications do not carry historical timestamps. The bridge therefore has to stamp
 * them when replay happens; after a daemon restart those timestamps can be hours or days after the
 * Task Run that actually produced the messages. Time-window slicing then returns an empty old Task
 * until the user sends another prompt and creates a new window around the replay time.
 *
 * A Task-owned native Session has one user turn per Run. When timestamps select no assistant reply,
 * recover by turn order instead. Taking the last N turns also tolerates a Session that contained
 * unrelated history before TaskDesk adopted it.
 */
function replayFallbackForRun(messages: MessageEnvelope[], ordinal: number, sessionRunCount: number): MessageEnvelope[] {
  if (!messages.length) return []
  const turns = transcriptTurns(messages)
  if (!turns.length) return sessionRunCount === 1 ? messages : []
  const firstTaskTurn = Math.max(0, turns.length - sessionRunCount)
  return turns[firstTaskTurn + ordinal] ?? (sessionRunCount === 1 ? turns[turns.length - 1] : [])
}

function nativeForRun(
  task: MachineTask,
  run: MachineTaskRun,
  index: number,
  next: MachineTaskRun | undefined,
  messages: MessageEnvelope[],
  agents: WorkThreadAgentMeta,
  seen: Set<string>,
  sessionOrdinal: number,
  sessionRunCount: number
): WorkThreadMessage[] {
  const start = runStart(task, run, index)
  const end = runEnd(run, next)
  const prompt = (run.prompt || (index === 0 ? task.prompt : "")).trim()
  const session = runSessionID(run) || `work-thread:${task.id}`
  const agentID = run.agentId || task.agentId
  const agent = agents[agentID]
  const result: WorkThreadMessage[] = []

  if (prompt) {
    result.push(syntheticMessage({
      id: `work-thread:${task.id}:run:${run.id || index}:user`,
      role: "user",
      sessionID: session,
      created: start,
      text: prompt,
      meta: { kind: "synthetic-user", runId: run.id, agentId: agentID, agentLabel: agent?.label, agentBackend: agent?.backend }
    }))
  }

  const timestampWindow = messages.filter((message) => {
    const created = Number(message.info?.time?.created) || 0
    return !created || created >= start - 5_000 && created < end
  })
  const nativeHasAssistant = messages.some((message) => message.info.role === "assistant")
  const windowHasAssistant = timestampWindow.some((message) => message.info.role === "assistant")
  const selectedMessages = nativeHasAssistant && !windowHasAssistant
    ? replayFallbackForRun(messages, sessionOrdinal, sessionRunCount)
    : timestampWindow

  for (const rawMessage of selectedMessages) {
    const message = compactAssistantMessage(rawMessage)
    const identity = `${message.info.sessionID || session}:${message.info.id}`
    if (seen.has(identity)) continue
    const nativeText = textParts(message.parts)
    if (message.info.role === "user" && (samePrompt(nativeText, prompt) || isTaskDeskTransfer(nativeText))) {
      seen.add(identity)
      continue
    }
    seen.add(identity)
    result.push({
      ...message,
      info: { ...message.info, id: `work-thread:${task.id}:${identity}` },
      taskdesk: { kind: "native", runId: run.id, agentId: agentID, agentLabel: agent?.label, agentBackend: agent?.backend }
    })
  }

  const hasAssistant = result.some((message) => message.info.role === "assistant")
  if (!hasAssistant && typeof run.outcome === "string" && run.outcome.trim()) {
    const finished = Date.parse(run.finishedAt || "")
    result.push(syntheticMessage({
      id: `work-thread:${task.id}:run:${run.id || index}:outcome`,
      role: "assistant",
      sessionID: session,
      created: Number.isFinite(finished) ? finished : start + 1,
      text: run.outcome.trim(),
      meta: { kind: "fallback-result", runId: run.id, agentId: agentID, agentLabel: agent?.label, agentBackend: agent?.backend }
    }))
  }

  if ((run.status === "failed" || (run.id === task.run?.id && task.status === "failed")) && task.error?.message) {
    const finished = Date.parse(run.finishedAt || "")
    result.push(syntheticMessage({
      id: `work-thread:${task.id}:run:${run.id || index}:error`,
      role: "taskdesk",
      sessionID: session,
      created: Number.isFinite(finished) ? finished + 1 : start + 2,
      text: task.error.message,
      meta: { kind: "error", runId: run.id, agentId: agentID, agentLabel: agent?.label, agentBackend: agent?.backend }
    }))
  }

  return result
}

function collapseDuplicateAssistantReplies(messages: WorkThreadMessage[]): WorkThreadMessage[] {
  const collapsed: WorkThreadMessage[] = []
  for (const message of messages) {
    const previous = collapsed.length ? collapsed[collapsed.length - 1] : undefined
    const currentText = message.info.role === "assistant" ? normalizedVisibleText(message) : ""
    const previousText = previous?.info.role === "assistant" ? normalizedVisibleText(previous) : ""
    const sameRun = Boolean(message.taskdesk?.runId && previous?.taskdesk?.runId && message.taskdesk.runId === previous.taskdesk.runId)
    const closeInTime = previous
      ? Math.abs((Number(message.info.time.created) || 0) - (Number(previous.info.time.created) || 0)) <= 60_000
      : false

    if (sameRun && closeInTime && currentText && currentText === previousText) continue
    collapsed.push(message)
  }
  return collapsed
}

export function buildWorkThreadTimeline(
  task: MachineTask,
  messagesBySession: Record<string, MessageEnvelope[]>,
  agents: WorkThreadAgentMeta
): WorkThreadMessage[] {
  const runs = runsFor(task)
  if (runs.length === 0) {
    const created = Date.parse(task.createdAt || "")
    return task.prompt?.trim() ? [syntheticMessage({
      id: `work-thread:${task.id}:objective`,
      role: "user",
      sessionID: `work-thread:${task.id}`,
      created: Number.isFinite(created) ? created : Date.now(),
      text: task.prompt.trim(),
      meta: { kind: "synthetic-user", agentId: task.agentId, agentLabel: agents[task.agentId]?.label, agentBackend: agents[task.agentId]?.backend }
    })] : []
  }

  const sessionCounts = new Map<string, number>()
  for (const run of runs) {
    const session = runSessionID(run)
    if (session) sessionCounts.set(session, (sessionCounts.get(session) ?? 0) + 1)
  }
  const sessionOrdinals = new Map<string, number>()
  const seen = new Set<string>()
  const timeline: WorkThreadMessage[] = []
  runs.forEach((run, index) => {
    const start = runStart(task, run, index)
    const event = eventText(runs, index, agents)
    if (event) {
      const agentID = run.agentId || task.agentId
      timeline.push(syntheticMessage({
        id: `work-thread:${task.id}:run:${run.id || index}:handoff`,
        role: "taskdesk",
        sessionID: runSessionID(run) || `work-thread:${task.id}`,
        created: start - 1,
        text: event,
        meta: { kind: "event", runId: run.id, agentId: agentID, agentLabel: agents[agentID]?.label, agentBackend: agents[agentID]?.backend }
      }))
    }
    const session = runSessionID(run)
    const ordinal = session ? sessionOrdinals.get(session) ?? 0 : 0
    if (session) sessionOrdinals.set(session, ordinal + 1)
    timeline.push(...nativeForRun(
      task,
      run,
      index,
      runs[index + 1],
      session ? messagesBySession[session] ?? [] : [],
      agents,
      seen,
      ordinal,
      session ? sessionCounts.get(session) ?? 1 : 1
    ))
  })

  const ordered = timeline
    .map((message, index) => ({ message, index }))
    .sort((left, right) => left.message.info.time.created - right.message.info.time.created || left.index - right.index)
    .map(({ message }) => message)

  return collapseDuplicateAssistantReplies(ordered)
}
