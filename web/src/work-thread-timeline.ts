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

type RunWithError = MachineTaskRun & { error?: { message?: string } | string | null }

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
  return (parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function isTaskDeskTransfer(text: string): boolean {
  return text.startsWith("You are taking over an existing TaskDesk task.")
    || (text.includes("The context below was transferred by TaskDesk") && text.includes("USER INSTRUCTION"))
}

function transferContainsPrompt(text: string, prompt: string): boolean {
  if (!isTaskDeskTransfer(text) || !prompt.trim()) return false
  return normalizedText(text).includes(normalizedText(prompt))
}

function samePrompt(left: string, right: string): boolean {
  return Boolean(right.trim()) && normalizedText(left) === normalizedText(right)
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

function userTextForTurn(turn: MessageEnvelope[]): string {
  const user = turn.find((message) => message.info.role === "user")
  return user ? textParts(user.parts) : ""
}

function promptTurnForRun(messages: MessageEnvelope[], prompt: string, ordinal: number, sessionRunCount: number): MessageEnvelope[] {
  if (!messages.length || !prompt.trim()) return []
  const matches = transcriptTurns(messages).filter((turn) => {
    const userText = userTextForTurn(turn)
    return samePrompt(userText, prompt) || transferContainsPrompt(userText, prompt)
  })
  if (!matches.length) return []
  if (matches.length === 1) return matches[0]
  const firstRelevant = Math.max(0, matches.length - sessionRunCount)
  return matches[firstRelevant + ordinal] ?? []
}

function replayFallbackForRun(messages: MessageEnvelope[], ordinal: number, sessionRunCount: number): MessageEnvelope[] {
  if (!messages.length) return []
  const turns = transcriptTurns(messages)
  if (!turns.length) return sessionRunCount === 1 ? messages : []
  const firstTaskTurn = Math.max(0, turns.length - sessionRunCount)
  return turns[firstTaskTurn + ordinal] ?? (sessionRunCount === 1 ? turns[turns.length - 1] : [])
}

function partText(part: MessagePart): string {
  return typeof part.text === "string" ? part.text.trim() : ""
}

function compactTextPartIDs(parts: MessagePart[]): Set<string> {
  const compacted: MessagePart[] = []
  for (const part of parts.filter((candidate) => candidate.type === "text" && partText(candidate))) {
    const text = partText(part)
    const previous = compacted[compacted.length - 1]
    const previousText = previous ? partText(previous) : ""
    const currentNormalized = normalizedText(text)
    const previousNormalized = normalizedText(previousText)

    if (previous && previousNormalized && currentNormalized.startsWith(previousNormalized) && currentNormalized.length > previousNormalized.length) {
      compacted[compacted.length - 1] = part
      continue
    }
    if (previous && currentNormalized && previousNormalized.startsWith(currentNormalized)) continue
    if (previous && currentNormalized === previousNormalized) {
      compacted[compacted.length - 1] = part
      continue
    }
    compacted.push(part)
  }
  return new Set(compacted.map((part) => part.id))
}

function normalizeAssistantParts(messages: MessageEnvelope[], aggregateID: string): MessagePart[] {
  const flattened: MessagePart[] = []
  const toolIndex = new Map<string, number>()
  const seenReasoning = new Set<string>()

  for (const message of messages) {
    for (const raw of message.parts ?? []) {
      const part: MessagePart = {
        ...raw,
        id: `${message.info.id}:${raw.id}`,
        messageID: aggregateID
      }

      if (part.type === "tool") {
        const identity = part.callID || `${message.info.id}:${raw.id}`
        const prior = toolIndex.get(identity)
        if (prior !== undefined) {
          flattened[prior] = part
          continue
        }
        toolIndex.set(identity, flattened.length)
      }

      if (part.type === "reasoning" && partText(part)) {
        const signature = normalizedText(partText(part))
        if (signature && seenReasoning.has(signature)) continue
        if (signature) seenReasoning.add(signature)
      }

      flattened.push(part)
    }
  }

  const keptText = compactTextPartIDs(flattened)
  return flattened.filter((part) => part.type !== "text" || keptText.has(part.id))
}

function lastTechnicalIndex(parts: MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].type === "reasoning" || parts[index].type === "tool") return index
  }
  return -1
}

function hasTerminalText(parts: MessagePart[]): boolean {
  const technical = lastTechnicalIndex(parts)
  return parts.some((part, index) => part.type === "text" && Boolean(partText(part)) && (technical < 0 || index > technical))
}

function assistantForRun({
  task,
  run,
  index,
  selected,
  start,
  end,
  usingReplayFallback,
  session,
  agentID,
  agentLabel,
  agentBackend,
  seenNative
}: {
  task: MachineTask
  run: MachineTaskRun
  index: number
  selected: MessageEnvelope[]
  start: number
  end: number
  usingReplayFallback: boolean
  session: string
  agentID: string
  agentLabel?: string
  agentBackend?: string
  seenNative: Set<string>
}): WorkThreadMessage | null {
  const assistants: MessageEnvelope[] = []
  for (const message of selected) {
    if (message.info.role !== "assistant") continue
    const identity = `${message.info.sessionID || session}:${message.info.id}`
    if (seenNative.has(identity)) continue
    seenNative.add(identity)
    assistants.push(message)
  }
  if (!assistants.length) return null

  const id = `work-thread:${task.id}:run:${run.id || index}:assistant`
  let parts = normalizeAssistantParts(assistants, id)
  const outcome = typeof run.outcome === "string" ? run.outcome.trim() : ""
  if (outcome && !hasTerminalText(parts)) {
    parts = [...parts, { id: `${id}:outcome`, messageID: id, type: "text", text: outcome }]
  }

  const nativeCreated = Number(assistants[0]?.info?.time?.created) || 0
  const needsSyntheticTiming = usingReplayFallback || !nativeCreated || nativeCreated < start - 5_000 || nativeCreated >= end
  const nativeError = assistants.find((message) => message.info.error)?.info.error

  return {
    info: {
      id,
      role: "assistant",
      sessionID: session,
      time: { created: needsSyntheticTiming ? start + 1 : nativeCreated },
      ...(nativeError ? { error: nativeError } : {})
    },
    parts,
    taskdesk: { kind: "native", runId: run.id, agentId: agentID, agentLabel, agentBackend }
  }
}

function runErrorText(task: MachineTask, run: MachineTaskRun): string {
  const persisted = (run as RunWithError).error
  if (typeof persisted === "string") return persisted.trim()
  if (persisted?.message) return persisted.message.trim()
  if (run.id && run.id === task.run?.id && task.error?.message) return task.error.message.trim()
  return ""
}

function nativeForRun(
  task: MachineTask,
  run: MachineTaskRun,
  index: number,
  next: MachineTaskRun | undefined,
  messages: MessageEnvelope[],
  agents: WorkThreadAgentMeta,
  seenNative: Set<string>,
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
  const promptTurn = promptTurnForRun(messages, prompt, sessionOrdinal, sessionRunCount)
  const promptTurnHasAssistant = promptTurn.some((message) => message.info.role === "assistant")
  const nativeHasAssistant = messages.some((message) => message.info.role === "assistant")
  const windowHasAssistant = timestampWindow.some((message) => message.info.role === "assistant")
  const usingReplayFallback = !promptTurnHasAssistant && nativeHasAssistant && !windowHasAssistant
  const selected = promptTurnHasAssistant
    ? promptTurn
    : usingReplayFallback
      ? replayFallbackForRun(messages, sessionOrdinal, sessionRunCount)
      : timestampWindow

  const assistant = assistantForRun({
    task,
    run,
    index,
    selected,
    start,
    end,
    usingReplayFallback,
    session,
    agentID,
    agentLabel: agent?.label,
    agentBackend: agent?.backend,
    seenNative
  })

  if (assistant) result.push(assistant)
  else if (typeof run.outcome === "string" && run.outcome.trim()) {
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

  const errorText = runErrorText(task, run)
  if (run.status === "failed" && errorText && !assistant?.info.error) {
    const finished = Date.parse(run.finishedAt || "")
    const assistantCreated = assistant?.info.time.created || start + 1
    result.push(syntheticMessage({
      id: `work-thread:${task.id}:run:${run.id || index}:error`,
      role: "taskdesk",
      sessionID: session,
      created: Number.isFinite(finished) ? Math.max(finished + 1, assistantCreated + 1) : assistantCreated + 1,
      text: `Turn failed: ${errorText}`,
      meta: { kind: "error", runId: run.id, agentId: agentID, agentLabel: agent?.label, agentBackend: agent?.backend }
    }))
  }

  return result
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
  const seenNative = new Set<string>()
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
      seenNative,
      ordinal,
      session ? sessionCounts.get(session) ?? 1 : 1
    ))
  })

  return timeline
    .map((message, index) => ({ message, index }))
    .sort((left, right) => left.message.info.time.created - right.message.info.time.created || left.index - right.index)
    .map(({ message }) => message)
}
