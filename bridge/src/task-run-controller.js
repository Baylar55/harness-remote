import { randomUUID } from "node:crypto"
import { taskLaunchError } from "./task-errors.js"
import { WorktreeManager } from "./worktree-manager.js"

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
    if (this.reconciliationError) {
      throw taskLaunchError("agent_unavailable", "Task state is unavailable", { cause: this.reconciliationError })
    }
  }

  async #terminal(taskID, run, status, error = null) {
    try { await this.taskStore.setRunState(taskID, { status, run, error, expectedRunId: run?.id }) } catch {}
  }

  async #adoptAcpTaskSession(task) {
    if (!task.run?.sessionId || task.run.transport !== "acp") return
    const service = this.acpService?.(task.agentId)
    if (!service) return
    const title = task.prompt?.trim().split("\n")[0].slice(0, 60)
    try { await service.adoptTaskSession(task.run.sessionId, { title, prompt: task.run?.prompt || task.prompt }) } catch {}
  }

  async reconcileAll() {
    for (const task of await this.taskStore.list()) {
      await this.#adoptAcpTaskSession(task)
      if (!["starting", "running"].includes(task.status)) continue
      if (!task.run?.id) {
        try { await this.taskStore.setRunState(task.id, { status: "failed", error: new Error("Active task has no persisted run identity") }) } catch {}
        continue
      }
      let state = "unknown"
      try { state = await this.taskLauncher.inspectRun?.(task) ?? "unknown" } catch {}
      if (state === "completed") await this.#terminal(task.id, task.run, "completed")
      else if (state === "failed") await this.#terminal(task.id, task.run, "failed", new Error("Task run could not be confirmed after daemon restart"))
    }
  }

  async inspectWorkspace(taskID) {
    await this.#awaitReconciliation()
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (task.workspace?.mode !== "worktree") return { managed: false, dirty: false, changeCount: 0 }
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
    if (!["draft", "completed", "failed", "cancelled"].includes(task.status)) {
      throw taskLaunchError("invalid_state", "Only draft or terminal tasks can start a run")
    }
    if (!task.workspace?.path) throw taskLaunchError("workspace_required", "Task workspace is not prepared")

    const requestedPrompt = typeof options.prompt === "string" ? options.prompt.trim() : ""
    const runPrompt = requestedPrompt || task.prompt
    if (!runPrompt) throw taskLaunchError("invalid_state", "A run prompt is required")

    const run = {
      id: this.runIDFactory(),
      agentId: task.agentId,
      sessionId: null,
      transport: null,
      directory: task.workspace.path,
      prompt: runPrompt,
      startedAt: this.clock()
    }
    let current = await this.taskStore.setRunState(taskID, { status: "starting", run })
    const currentForRun = () => ({ ...current, prompt: runPrompt })
    try {
      const session = await this.taskLauncher.createSession(currentForRun())
      const linkedRun = { ...run, sessionId: session.sessionId, transport: session.transport }
      current = await this.taskStore.setRunState(taskID, { status: "starting", run: linkedRun, expectedRunId: run.id })
      current = await this.taskStore.setRunState(taskID, { status: "running", run: linkedRun, expectedRunId: linkedRun.id })
      const onFailed = (error) => void this.#terminal(taskID, linkedRun, "failed", error)
      onFailed.onFailed = onFailed
      onFailed.onCompleted = () => void this.#terminal(taskID, linkedRun, "completed")
      await this.taskLauncher.startPrompt(currentForRun(), session, onFailed)
      return current
    } catch (error) {
      await this.#terminal(taskID, current.run ?? run, "failed", error)
      throw error
    }
  }

  async continue(taskID, prompt) {
    const text = typeof prompt === "string" ? prompt.trim() : ""
    if (!text) throw taskLaunchError("invalid_state", "A continuation prompt is required")
    const task = await this.taskStore.get(taskID)
    if (!task) throw taskLaunchError("unknown_task", `Unknown task: ${taskID}`)
    if (!["completed", "failed", "cancelled"].includes(task.status)) {
      throw taskLaunchError("invalid_state", "Only a terminal task can start another run")
    }
    return this.launch(taskID, { prompt: text })
  }
}
