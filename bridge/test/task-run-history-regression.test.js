import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"
import { TaskLauncher } from "../src/task-launcher.js"

function completedTask() {
  return {
    id: "task-123456789",
    status: "completed",
    agentId: "pi",
    prompt: "Initial task",
    model: null,
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "project", path: "/repo" },
    run: {
      id: "run-1",
      sequence: 1,
      sessionId: "session-1",
      transport: "acp",
      directory: "/repo",
      prompt: "Initial task"
    },
    runs: [{
      id: "run-1",
      sequence: 1,
      sessionId: "session-1",
      transport: "acp",
      directory: "/repo",
      prompt: "Initial task"
    }]
  }
}

test("Continue creates a distinct numbered Run and a new Session", async () => {
  let current = completedTask()
  const created = []
  const store = {
    async list() { return [] },
    async get() { return structuredClone(current) },
    async setRunState(_taskID, update) {
      const nextRun = structuredClone(update.run ?? current.run)
      const runs = Array.isArray(current.runs) ? current.runs.map((run) => structuredClone(run)) : []
      const index = runs.findIndex((run) => run.id === nextRun?.id)
      if (nextRun?.id && index >= 0) runs[index] = structuredClone(nextRun)
      else if (nextRun?.id) runs.push(structuredClone(nextRun))
      current = { ...current, status: update.status, run: nextRun, runs }
      return structuredClone(current)
    }
  }
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async createSession(task) {
        created.push({ sequence: task.run.sequence, prompt: task.prompt })
        return { sessionId: "session-2", transport: "acp", directory: task.workspace.path }
      },
      async startPrompt() {}
    },
    runIDFactory: () => "run-2",
    clock: () => "2026-08-20T08:00:00.000Z"
  })

  const continued = await controller.continue("task-123456789", "Second request")
  assert.equal(continued.run.id, "run-2")
  assert.equal(continued.run.sequence, 2)
  assert.equal(continued.run.sessionId, "session-2")
  assert.deepEqual(created, [{ sequence: 2, prompt: "Second request" }])
  assert.deepEqual(continued.runs.map((run) => run.sessionId), ["session-1", "session-2"])
})

test("continuation Sessions are visibly distinguished by their Run number", async () => {
  let receivedTitle = null
  const service = {
    async createSession(options) {
      receivedTitle = options.title
      return { id: "session-2" }
    }
  }
  const launcher = new TaskLauncher({
    daemon: {
      hostEntry() { return { kind: "acp", host: {} } },
      registry: { host() { return { state: "available" } } }
    },
    acpService: () => service
  })

  await launcher.createSession({
    ...completedTask(),
    run: { ...completedTask().run, id: "run-2", sequence: 2 }
  })

  assert.equal(receivedTitle, "Task task-123 · Run 2")
})
