import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"

function draft(overrides = {}) {
  return {
    id: "task-1",
    status: "draft",
    agentId: "codex",
    prompt: "Fix it",
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "worktree", path: "/state/worktrees/task-1" },
    run: null,
    runs: [],
    ...overrides
  }
}

test("launch persists run identity before starting the prompt and ends running", async () => {
  let current = draft()
  const calls = []
  const store = {
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      calls.push(["state", update.status, update.run.sessionId])
      current = { ...current, status: update.status, run: structuredClone(update.run) }
      return structuredClone(current)
    }
  }
  const launcher = {
    async createSession(task) {
      calls.push(["session", task.status])
      return { sessionId: "session-1", transport: "acp", directory: task.workspace.path }
    },
    async startPrompt(task, session) { calls.push(["prompt", task.status, session.sessionId, task.prompt]) }
  }
  const controller = new TaskRunController({ taskStore: store, taskLauncher: launcher, runIDFactory: () => "run-1", clock: () => "2026-08-13T18:00:00.000Z" })

  const result = await controller.launch("task-1")
  assert.equal(result.status, "running")
  assert.equal(result.run.id, "run-1")
  assert.equal(result.run.sessionId, "session-1")
  assert.deepEqual(calls, [
    ["state", "starting", null],
    ["session", "starting"],
    ["state", "starting", "session-1"],
    ["state", "running", "session-1"],
    ["prompt", "running", "session-1", "Fix it"]
  ])
})

test("a synchronous prompt completion cannot race the starting to running transition", async () => {
  let current = draft()
  const store = {
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      if (update.status === "running" && current.status !== "starting") throw new Error("Task is not starting")
      if (["completed", "failed"].includes(update.status) && !["starting", "running"].includes(current.status)) throw new Error("Task is not active")
      current = { ...current, status: update.status, run: structuredClone(update.run), error: update.error }
      return structuredClone(current)
    }
  }
  const launcher = {
    async createSession(task) { return { sessionId: "session-1", transport: "acp", directory: task.workspace.path } },
    async startPrompt(_task, _session, callbacks) { callbacks.onCompleted() }
  }
  const controller = new TaskRunController({ taskStore: store, taskLauncher: launcher, runIDFactory: () => "run-1" })

  const launched = await controller.launch("task-1")
  assert.equal(launched.status, "running")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(current.status, "completed")
})

test("Git tasks can intentionally launch from the project checkout", async () => {
  let current = draft({ workspace: { mode: "project", path: "/repo" } })
  const store = {
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      current = { ...current, status: update.status, run: structuredClone(update.run) }
      return structuredClone(current)
    }
  }
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async createSession(task) {
        assert.equal(task.workspace.mode, "project")
        assert.equal(task.workspace.path, "/repo")
        return { sessionId: "session-project", transport: "acp" }
      },
      async startPrompt() {}
    },
    runIDFactory: () => "run-project"
  })
  const launched = await controller.launch("task-1")
  assert.equal(launched.status, "running")
  assert.equal(launched.run.directory, "/repo")
})

test("a terminal task can continue with a new run and prompt", async () => {
  let current = draft({
    status: "completed",
    run: { id: "run-1", sessionId: "session-1", transport: "acp", directory: "/state/worktrees/task-1" },
    runs: [{ id: "run-1", sessionId: "session-1", transport: "acp", directory: "/state/worktrees/task-1" }]
  })
  let createdPrompt
  let sentPrompt
  const store = {
    async list() { return [] },
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      current = { ...current, status: update.status, run: structuredClone(update.run) }
      return structuredClone(current)
    }
  }
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async createSession(task) {
        createdPrompt = task.prompt
        return { sessionId: "session-2", transport: "acp", directory: task.workspace.path }
      },
      async startPrompt(task) { sentPrompt = task.prompt }
    },
    runIDFactory: () => "run-2"
  })

  const continued = await controller.continue("task-1", "Now add regression tests")
  assert.equal(continued.status, "running")
  assert.equal(continued.run.id, "run-2")
  assert.equal(continued.run.sessionId, "session-2")
  assert.equal(continued.run.prompt, "Now add regression tests")
  assert.equal(createdPrompt, "Now add regression tests")
  assert.equal(sentPrompt, "Now add regression tests")
})

test("launch failures persist failed state", async () => {
  let current = draft()
  const states = []
  const controller = new TaskRunController({
    taskStore: {
      async get() { return structuredClone(current) },
      async setRunState(_id, update) {
        states.push(update.status)
        current = { ...current, status: update.status, run: update.run, error: update.error }
        return structuredClone(current)
      }
    },
    taskLauncher: { async createSession() { throw new Error("agent unavailable") } },
    runIDFactory: () => "run-1"
  })
  await assert.rejects(() => controller.launch("task-1"), /agent unavailable/)
  assert.deepEqual(states, ["starting", "failed"])
})

test("asynchronous prompt failures mark the same running run failed", async () => {
  let current = draft()
  let rejectPrompt
  const store = {
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      current = { ...current, status: update.status, run: structuredClone(update.run), error: update.error }
      return structuredClone(current)
    }
  }
  const launcher = {
    async createSession(task) { return { sessionId: "session-1", transport: "acp", directory: task.workspace.path } },
    async startPrompt(_task, _session, onPromptFailed) { rejectPrompt = onPromptFailed }
  }
  const controller = new TaskRunController({ taskStore: store, taskLauncher: launcher, runIDFactory: () => "run-1" })
  const launched = await controller.launch("task-1")
  assert.equal(launched.status, "running")

  rejectPrompt(new Error("prompt failed"))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(current.status, "failed")
  assert.equal(current.run.id, "run-1")
})

test("reconciliation load failures stay isolated and surface as unavailable", async () => {
  const controller = new TaskRunController({
    taskStore: {
      async list() { throw new Error("permission denied") },
      async get() { throw new Error("should not read tasks after failed reconciliation") }
    },
    taskLauncher: {}
  })

  await controller.reconciliation
  await assert.rejects(
    () => controller.inspectWorkspace("task-1"),
    (error) => error.code === "agent_unavailable" && error.message === "Task state is unavailable"
  )
})

test("reconciliation adopts an ACP task session and keeps an unconfirmable ACP run active", async () => {
  let current = draft({
    status: "running",
    run: { id: "run-1", agentId: "pi", sessionId: "pi-session", transport: "acp", directory: "/state/worktrees/task-1" }
  })
  const adopted = []
  const controller = new TaskRunController({
    taskStore: {
      async list() { return [structuredClone(current)] },
      async setRunState(_id, update) {
        current = { ...current, status: update.status, error: update.error }
        return structuredClone(current)
      }
    },
    taskLauncher: { async inspectRun() { return "unknown" } },
    acpService: () => ({
      async adoptTaskSession(sessionID, details) { adopted.push({ sessionID, details }) }
    })
  })

  await controller.reconciliation
  assert.equal(current.status, "running")
  assert.deepEqual(adopted, [{
    sessionID: "pi-session",
    details: { title: "Fix it", prompt: "Fix it" }
  }])
})
