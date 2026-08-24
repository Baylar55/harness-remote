import { api, type MessagePage } from "./api"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"
import { sendNativeSessionPrompt } from "./native-session-prompt"
import { stopNativeSession } from "./native-session-stop"
import {
  taskClient,
  type AgentModelScope,
  type MachineTask,
  type MachineTaskRun,
  type TaskContinueInput
} from "./taskClient"
import type { MessageEnvelope, ModelSelection, ServerConfig } from "./types"

const PROJECTION_ID_PREFIX = "native-session-v3:"

type ProjectionRun = {
  id: string
  prompt: string
  created: number
  model: ModelSelection | null
}

type ProjectionEntry = {
  target: NativeSessionSurfaceTarget
  createdAt: number
  updatedAt: number
  statusType: string
  forcedStatus: "running" | "cancelled" | null
  currentModel: ModelSelection | null
  initialPageCaptured: boolean
  runs: Map<string, ProjectionRun>
  listeners: Set<(task: MachineTask) => void>
}

const projections = new Map<string, ProjectionEntry>()
let installed = false

export function nativeSessionIsWorking(status?: string): boolean {
  const value = status?.trim().toLowerCase() || ""
  return value === "busy" || value === "running" || value === "working" || value === "in_progress" || value === "in-progress"
}

function projectionID(target: NativeSessionSurfaceTarget): string {
  return `${PROJECTION_ID_PREFIX}${encodeURIComponent(target.machineID)}:${encodeURIComponent(target.agentID)}:${encodeURIComponent(target.sessionID)}`
}

function canonicalText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim()
}

function messageText(message: MessageEnvelope): string {
  return (message.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

/**
 * The old v3 handoff packet is transport context, not visible dialogue. This adapter only extracts
 * the same USER INSTRUCTION marker so the mature work-thread timeline can match the native turn.
 */
function visiblePrompt(message: MessageEnvelope): string {
  const value = canonicalText(messageText(message))
  if (!value.startsWith("You are taking over an existing TaskDesk task.")) return value
  const marker = "\nUSER INSTRUCTION\n"
  const start = value.indexOf(marker)
  if (start < 0) return value
  const instructionStart = start + marker.length
  const footerStart = value.indexOf("\n\nContinue from the shared workspace", instructionStart)
  return canonicalText(value.slice(instructionStart, footerStart >= 0 ? footerStart : undefined))
}

function iso(timestamp: number): string {
  return new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()).toISOString()
}

function sameServer(left: ServerConfig, right: ServerConfig): boolean {
  return left.host === right.host
    && left.port === right.port
    && left.username === right.username
    && left.password === right.password
    && (left.agentId || "") === (right.agentId || "")
}

function entryForRead(config: ServerConfig, sessionID: string, directory?: string): ProjectionEntry | undefined {
  for (const entry of projections.values()) {
    if (entry.target.sessionID !== sessionID || !sameServer(entry.target.config, config)) continue
    if (directory && entry.target.directory && directory !== entry.target.directory) continue
    return entry
  }
  return undefined
}

function taskStatus(entry: ProjectionEntry): string {
  if (entry.forcedStatus) return entry.forcedStatus
  return nativeSessionIsWorking(entry.statusType) ? "running" : "completed"
}

function sortedRuns(entry: ProjectionEntry): MachineTaskRun[] {
  const status = taskStatus(entry)
  const ordered = [...entry.runs.values()].sort((left, right) => left.created - right.created || left.id.localeCompare(right.id))
  if (ordered.length === 0) {
    return [{
      id: `${projectionID(entry.target)}:anchor`,
      sequence: 1,
      agentId: entry.target.agentID,
      model: entry.currentModel,
      role: "continue",
      sessionId: entry.target.sessionID,
      status,
      transport: entry.target.transport,
      directory: entry.target.directory,
      prompt: "",
      startedAt: iso(entry.createdAt),
      ...(status === "running" ? {} : { finishedAt: iso(entry.updatedAt) })
    }]
  }

  return ordered.map((run, index) => ({
    id: run.id,
    sequence: index + 1,
    agentId: entry.target.agentID,
    model: run.model,
    role: index === 0 ? "implement" : "continue",
    sessionId: entry.target.sessionID,
    status: index === ordered.length - 1 ? status : "completed",
    transport: entry.target.transport,
    directory: entry.target.directory,
    prompt: run.prompt,
    startedAt: iso(run.created),
    ...(index === ordered.length - 1 && status === "running" ? {} : { finishedAt: iso(Math.max(run.created, entry.updatedAt)) })
  }))
}

function projectedTask(entry: ProjectionEntry): MachineTask {
  const runs = sortedRuns(entry)
  const current = runs[runs.length - 1] ?? null
  const firstPrompt = runs.find((run) => run.prompt?.trim())?.prompt || ""
  const projectName = entry.target.directory.split(/[\\/]/).filter(Boolean).at(-1) || entry.target.title || "Native Session"
  return {
    id: projectionID(entry.target),
    machineId: entry.target.machineID,
    projectId: `native:${entry.target.directory || entry.target.sessionID}`,
    project: { name: projectName, path: entry.target.directory, kind: "directory" },
    title: entry.target.title,
    agentId: entry.target.agentID,
    prompt: firstPrompt,
    model: entry.currentModel,
    status: taskStatus(entry),
    workspace: { mode: "project", path: entry.target.directory },
    run: current,
    runs,
    error: null,
    createdAt: iso(entry.createdAt),
    updatedAt: iso(entry.updatedAt),
    ...(taskStatus(entry) === "running" ? {} : { finishedAt: iso(entry.updatedAt) })
  }
}

function notify(entry: ProjectionEntry): MachineTask {
  const task = projectedTask(entry)
  for (const listener of entry.listeners) listener(task)
  return task
}

function captureUserRuns(entry: ProjectionEntry, page: MessagePage, before?: string): void {
  // The first page describes the Session state that existed when the v3 controller mounted. Older
  // pages are admitted when the user explicitly pages backward. Tail refreshes do not manufacture
  // new Runs from replay IDs: new HR prompts already have one accepted client operation identity.
  const mayDiscoverRuns = !entry.initialPageCaptured || Boolean(before)
  if (!mayDiscoverRuns) return

  let changed = false
  for (const message of page.messages) {
    if (message.info.role !== "user" || !message.info.id) continue
    const prompt = visiblePrompt(message)
    if (!prompt) continue
    const id = `${projectionID(entry.target)}:native-user:${message.info.id}`
    if (entry.runs.has(id)) continue
    const created = Number(message.info.time?.created) || entry.createdAt
    entry.runs.set(id, { id, prompt, created, model: entry.currentModel })
    entry.createdAt = Math.min(entry.createdAt, created)
    entry.updatedAt = Math.max(entry.updatedAt, created)
    changed = true
  }
  if (!entry.initialPageCaptured) entry.initialPageCaptured = true
  if (changed) notify(entry)
}

function appendAcceptedRun(entry: ProjectionEntry, prompt: string, model: ModelSelection | null, clientRequestId: string): MachineTask {
  const id = `${projectionID(entry.target)}:request:${clientRequestId}`
  if (!entry.runs.has(id)) {
    const created = Date.now()
    entry.runs.set(id, { id, prompt: canonicalText(prompt), created, model })
    entry.updatedAt = created
  }
  entry.currentModel = model
  entry.forcedStatus = "running"
  entry.statusType = "running"
  return notify(entry)
}

async function refreshStatus(entry: ProjectionEntry): Promise<void> {
  try {
    const statuses = await api.listStatuses(entry.target.config, entry.target.directory)
    const next = statuses[entry.target.sessionID]?.type
    if (typeof next === "string" && next) {
      entry.statusType = next
      if (!nativeSessionIsWorking(next)) entry.forcedStatus = null
    }
  } catch {
    // Status is enrichment. The v3 transcript remains the authority when this lightweight read fails.
  }
}

function installAdapter(): void {
  if (installed) return
  installed = true

  const originalLoadMessagePage = api.loadMessagePage.bind(api)
  api.loadMessagePage = async function patchedLoadMessagePage(config, sessionID, directory, before, limit, refreshHistory) {
    const page = await originalLoadMessagePage(config, sessionID, directory, before, limit, refreshHistory)
    const entry = entryForRead(config, sessionID, directory)
    if (entry) captureUserRuns(entry, page, before)
    return page
  }

  const originalGetWorkThread = taskClient.getWorkThread.bind(taskClient)
  taskClient.getWorkThread = async function patchedGetWorkThread(config, taskId) {
    const entry = projections.get(taskId)
    if (!entry) return originalGetWorkThread(config, taskId)
    await refreshStatus(entry)
    return projectedTask(entry)
  }

  const originalListAgentModels = taskClient.listAgentModels.bind(taskClient)
  taskClient.listAgentModels = async function patchedListAgentModels(config, agentId, scope: AgentModelScope = {}) {
    const entry = scope.workThreadId ? projections.get(scope.workThreadId) : undefined
    return originalListAgentModels(config, agentId, entry ? {} : scope)
  }

  const originalContinueTask = taskClient.continueTask.bind(taskClient)
  taskClient.continueTask = async function patchedContinueTask(config, taskId, input) {
    const entry = projections.get(taskId)
    if (!entry) return originalContinueTask(config, taskId, input)
    const body: TaskContinueInput = typeof input === "string" ? { prompt: input } : input
    const prompt = body.prompt?.trim() || ""
    if (!prompt) throw new Error("A text prompt is required")
    if (body.agentId && body.agentId !== entry.target.agentID) {
      throw new Error("Cross-agent continuation is disabled until single-Session parity is validated")
    }
    const model = body.model === undefined ? entry.currentModel : body.model
    const result = await sendNativeSessionPrompt(entry.target, prompt, model)
    if (result.status !== "accepted") {
      throw new Error(`Prompt delivery is ${result.status}. Retry the same prompt to reconcile the existing request id.`)
    }
    return appendAcceptedRun(entry, prompt, model ?? null, result.clientRequestId)
  }

  const originalCancelWorkThread = taskClient.cancelWorkThread.bind(taskClient)
  taskClient.cancelWorkThread = async function patchedCancelWorkThread(config, taskId) {
    const entry = projections.get(taskId)
    if (!entry) return originalCancelWorkThread(config, taskId)
    const latestRun = sortedRuns(entry).at(-1)
    const operationToken = latestRun?.id || entry.target.sessionID
    const result = await stopNativeSession(entry.target, operationToken)
    if (result.status !== "accepted") {
      throw new Error(`Stop delivery is ${result.status}. The existing native cancel request will be reconciled instead of repeated.`)
    }
    entry.forcedStatus = "cancelled"
    entry.statusType = "idle"
    entry.updatedAt = Date.now()
    return notify(entry)
  }
}

export function registerNativeSessionV3Adapter(
  target: NativeSessionSurfaceTarget,
  onTaskUpdate: (task: MachineTask) => void
): { task: MachineTask; dispose: () => void } {
  installAdapter()
  const id = projectionID(target)
  let entry = projections.get(id)
  if (!entry) {
    const now = Date.now()
    entry = {
      target,
      createdAt: now,
      updatedAt: now,
      statusType: target.status?.type || "idle",
      forcedStatus: null,
      currentModel: target.model,
      initialPageCaptured: false,
      runs: new Map(),
      listeners: new Set()
    }
    projections.set(id, entry)
  } else {
    entry.target = target
    entry.statusType = target.status?.type || entry.statusType
    entry.currentModel = target.model ?? entry.currentModel
  }
  entry.listeners.add(onTaskUpdate)
  return {
    task: projectedTask(entry),
    dispose: () => {
      entry?.listeners.delete(onTaskUpdate)
      if (entry && entry.listeners.size === 0) projections.delete(id)
    }
  }
}

export function isNativeSessionV3Projection(taskId: string): boolean {
  return taskId.startsWith(PROJECTION_ID_PREFIX)
}
