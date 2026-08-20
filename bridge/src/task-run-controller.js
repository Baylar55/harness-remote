import { randomUUID } from "node:crypto"
import { buildTaskContext, formatTaskHandoff } from "./task-context.js"
import { taskLaunchError } from "./task-errors.js"
import { normalizeTaskModel } from "./task-model.js"
import { WorktreeManager } from "./worktree-manager.js"

function taskRuns(task) {
  if (Array.isArray(task?.runs) && task.runs.length) return task.runs
  return task?.run ? [task.run] : []
}

function runAgent(task, run) {
  return run?.agentId || task?.agentId || ""
}

function latestRunForAgent(task, agentID, { requireSession = false } = {}) {
  const runs = taskRuns(task)
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (runAgent(task, run) !== agentID) continue
    if (requireSession && !run?.sessionId) continue
    return run
  }
  return null
}

function requestedAgent(task, options = {}) {
  const explicit = typeof options.agentId === "string" ? options.agentId.trim() : ""
  return explicit || runAgent(task, task.run)
}

function requestedModel(task, targetAgent, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "model")) return normalizeTaskModel(options.model)
  const priorTargetRun = latestRunForAgent(task, targetAgent)
  if (priorTargetRun?.model) return normalizeTaskModel(priorTargetRun.model)
  if (targetAgent === task.agentId) return normalizeTaskModel(task.model)
  return null
}

function requestedRole(task, options = {}) {
  const explicit = typeof options.role === "string" ? options.role.trim() : ""
  if (explicit) return explicit
  return task.run ? "continue" : "implement"
}

function completedRun(run, result) {
  const outcome = typeof result?.outcome === "string" ? result.outcome.trim() : ""
  return outcome ? { ...run, outcome } : run
}

export class TaskRunController {
  constructor({ taskStore, taskLauncher, worktreeManager, acpService, runIDFactory = randomUUID, clock = () => new Date().toISOString() }) {
    this.taskStore = taskStore
    this.taskLauncher = taskLauncher
    this.worktreeManager = worktreeManager ?? (taskStore?.stateDirectory ? new WorktreeManager({ stateDirectory: taskStore.stateDirectory }) : undefined)
    this.acpService = acpService
    this.runIDFactory = runIDFactory
    this.clock = clock
    this.reconciliationError = null
    this.reconciliation = (typeof taskStore?.list === "function" ? this.reconcileAll() : Promise.resolve())
      .catch((error) => { this.reconciliationError = error })
  }

  async #awaitReconciliation() {
    await this.reconciliation
    if (this.reconciliationError) throw taskLaunchError("agent_unavailable", "Task state is unavailable", { cause: this.reconciliationError })
  }

  async #terminal(taskID, run, status, error = null, result = null) {
    const terminalRun = status === "completed" ? completedRun(run, result) : run
    try { await this.taskStore.setRunState(taskID, { status, run: terminalRun, error, expectedRunId: run?.id }) } catch {}
  }

  async #adoptAcpTaskSession(task) {
    if (!task.run?.sessionId || task.run.transport !== "acp") return null
    const agentID = runAgent(task, task.run)
    const service = this.acpService?.(agentID)
    if (!service) return null
    const title = task.prompt?.trim().split("\n")[0].slice(0, 60)
    try {
      return await service.adoptTaskSession(task.run.sessionId, { title, prompt: task.run?.prompt || task.prompt })
    } catch {
      return null
    }
  }

  async #contextForTask(task) {
    let workspace = { managed: task.workspace?.mode === "worktree", dirty: false, changeCount: 0, changedFiles: [] }
    if (task.workspace?.mode === "worktree" && this.worktreeManager) {
      try {
        workspace = await this.worktreeManager.inspect(task.workspace)
      } catch {
        // Context remains useful even when the workspace cannot be inspected temporarily.
      }
    }
    return buildTaskContext(task, { workspace })
  }

  async reconcileAll() {
    for (const task of await this.taskStore.list()) {
      const adoptedAcpSession = await this.#adoptAcpTaskSession(task)
      if (!["starting", "running"].includes(task.status)) continue
      if (!task.run?.id) {
        try { await this.taskStore.setRunState(task.id, { status: "failed", error: new Error("Active task has no persisted run identity") }) } catch {}
        continue
      }
      if (task.run.transport === "acp" && adoptedAcpSession === false) {
        await this.#terminal(task.id, task.run, "failed", new Error("Task session is no longer available after daemon restart"))
        continue
      }
      let state = "unknown"
      try { state = await this.taskLauncher.inspectRun?.(task) ?? "unknown" } catch {}
      if (state === "completed") await this.#terminal(task.id, task.run, "completed")
      else if (state === "failed") await this.#terminal(task.id, task.run, "failed", new Error("Task run could not be confirmed after daemon restart"))
    }
  }

  async context(taskID) {
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    return this.#contextForTask(task)
  }

  async inspectWorkspace(taskID) {
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (task.workspace?.mode !== "worktree") return { managed: false, dirty: false, changeCount: 0, changedFiles: [] }
    if (!this.worktreeManager) throw new Error("Worktree manager is not configured")
    return this.worktreeManager.inspect(task.workspace)
  }

  async cleanupWorkspace(taskID) {
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (task.status === "starting" || task.status === "running") throw taskLaunchError("task_active", "An active task cannot release its workspace")
    if (task.workspace?.mode !== "worktree") return { task, cleanup: { removed: false, branchDeleted: false } }
    if (!this.worktreeManager) throw new Error("Worktree manager is not configured")
    const cleanup = await this.worktreeManager.cleanup(task.workspace)
    const updated = await this.taskStore.clearWorkspace(taskID)
    return { task: updated, cleanup }
  }

  async launch(taskID, options = {}) {
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (!["draft", "completed", "failed", "cancelled"].includes(task.status)) throw taskLaunchError("invalid_state", "Only draft or terminal tasks can start a run")
    if (!task.workspace?.path) throw taskLaunchError("workspace_required", "Task workspace is not prepared")

    const requestedPrompt = typeof options.prompt === "string" ? options.prompt.trim() : ""
    const userPrompt = requestedPrompt || task.prompt
    if (!userPrompt) throw taskLaunchError("invalid_state", "A run prompt is required")

    const previousRun = task.run ? structuredClone(task.run) : null
    const agentID = requestedAgent(task, options)
    if (!agentID) throw taskLaunchError("unknown_agent", "A target harness is required")
    const model = requestedModel(task, agentID, options)
    const role = requestedRole(task, options)
    const reuseSession = options.reuseSession === true
    const reusableRun = reuseSession ? latestRunForAgent(task, agentID, { requireSession: true }) : null
    if (reuseSession && !reusableRun) throw taskLaunchError("session_unavailable", "The requested native Session cannot be reused for this Run")

    const context = await this.#contextForTask(task)
    const directNativeContinuation = Boolean(reusableRun && previousRun && reusableRun.id === previousRun.id)
    const needsHandoffContext = Boolean(previousRun && (!reuseSession || !directNativeContinuation))
    const effectivePrompt = needsHandoffContext
      ? formatTaskHandoff(context, { targetAgentId: agentID, role, instruction: userPrompt })
      : userPrompt

    const previousRunCount = taskRuns(task).length
    const run = {
      id: this.runIDFactory(),
      sequence: previousRunCount + 1,
      agentId: agentID,
      model,
      role,
      contextRevision: Number(context.revision) || 0,
      ...(needsHandoffContext ? { handoffFromRunId: previousRun?.id ?? null } : {}),
      ...(reusableRun ? { resumedFromRunId: reusableRun.id ?? null } : {}),
      sessionId: null,
      transport: null,
      directory: task.workspace.path,
      prompt: userPrompt,
      startedAt: this.clock()
    }
    let current = await this.taskStore.setRunState(taskID, { status: "starting", run })
    const currentForRun = () => ({
      ...current,
      agentId: agentID,
      model,
      prompt: effectivePrompt,
      run: current.run ? { ...current.run, agentId: agentID, model } : current.run
    })
    try {
      const session = reuseSession
        ? await this.taskLauncher.resumeSession(currentForRun(), reusableRun)
        : await this.taskLauncher.createSession(currentForRun())
      const linkedRun = { ...run, sessionId: session.sessionId, transport: session.transport }
      current = await this.taskStore.setRunState(taskID, { status: "starting", run: linkedRun, expectedRunId: run.id })
      current = await this.taskStore.setRunState(taskID, { status: "running", run: linkedRun, expectedRunId: linkedRun.id })
      const onFailed = (error) => void this.#terminal(taskID, linkedRun, "failed", error)
      onFailed.onFailed = onFailed
      onFailed.onCompleted = (result) => void this.#terminal(taskID, linkedRun, "completed", null, result)
      await this.taskLauncher.startPrompt(currentForRun(), session, onFailed)
      return current
    } catch (error) {
      await this.#terminal(taskID, current.run ?? run, "failed", error)
      throw error
    }
  }

  async continue(taskID, input) {
    const options = typeof input === "string" ? { prompt: input } : input && typeof input === "object" ? input : {}
    const text = typeof options.prompt === "string" ? options.prompt.trim() : ""
    if (!text) throw taskLaunchError("invalid_state", "A continuation prompt is required")
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (!["completed", "failed", "cancelled"].includes(task.status)) throw taskLaunchError("invalid_state", "Only a terminal task can start another run")

    const agentID = requestedAgent(task, options)
    const explicitFresh = options.mode === "fresh" || options.fresh === true
    const reusableRun = latestRunForAgent(task, agentID, { requireSession: true })
    const reuseSession = !explicitFresh && Boolean(reusableRun)
    if (!explicitFresh && agentID === runAgent(task, task.run) && !reusableRun) {
      throw taskLaunchError("session_unavailable", "The previous native Session cannot be resumed. Start a fresh Run explicitly instead.")
    }

    return this.launch(taskID, { ...options, prompt: text, agentId: agentID, reuseSession })
  }
}
