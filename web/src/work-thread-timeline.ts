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

function normalizedVisibleText(message: MessageEnvelope): string {
  return textParts(message.parts).replace(/\s+/g, " ").trim()
}

function isTaskDeskTransfer(text: string): boolean {
  return text.startsWith("You are taking over an existing TaskDesk task.")
    || (text.includes("The context below was transferred by TaskDesk") && text.includes("USER INSTRUCTION"))
}

function samePrompt(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ")
  return Boolean(right.trim()) && normalize(left) === normalize(right)
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

function nativeForRun(
  task: MachineTask,
  run: MachineTaskRun,
  index: number,
  next: MachineTaskRun | undefined,
  messages: MessageEnvelope[],
  agents: WorkThreadAgentMeta,
  seen: Set<string>
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

  for (const message of messages) {
    const created = Number(message.info?.time?.created) || 0
    if (created && (created < start - 5_000 || created >= end)) continue
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

    // Some harness transports can journal the same completed assistant turn twice with different
    // native message ids during tail reconciliation. Message-id deduplication cannot catch that.
    // Collapse only consecutive assistant replies from the same persisted Run with identical visible
    // text so intentional repeated replies in later turns remain untouched.
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
    timeline.push(...nativeForRun(task, run, index, runs[index + 1], session ? messagesBySession[session] ?? [] : [], agents, seen))
  })

  const ordered = timeline
    .map((message, index) => ({ message, index }))
    .sort((left, right) => left.message.info.time.created - right.message.info.time.created || left.index - right.index)
    .map(({ message }) => message)

  return collapseDuplicateAssistantReplies(ordered)
}
