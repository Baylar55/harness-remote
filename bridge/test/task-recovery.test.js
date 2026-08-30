import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"

function activeTask(overrides = {}) {
  return {
    id: "task-1",
    status: "running",
    agentId: "pi",
    prompt: "Do work",
    workspace: { mode: "worktree", path: "/tmp/task-1" },
    run: { id: "run-1", sessionId: "session-1", transport: "acp", directory: "/tmp/task-1" },
    ...overrides
  }
}

function mutableStore(initial) {
  let current = structuredClone(initial)
  const writes = []
  return {
    writes,
    current: () => structuredClone(current),
    async list() { return [structuredClone(current)] },
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      writes.push(update.status)
      current = {
        ...current,
        status: update.status,
        run: structuredClone(update.run ?? current.run),
        error: update.error ? { message: update.error.message } : null
      }
      return structuredClone(current)
    }
  }
}

test("reconciliation fails an active ACP task when its saved session no longer exists", async () => {
  const store = mutableStore(activeTask())
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: { async inspectRun() { throw new Error("should not inspect a missing ACP session") } },
    acpService: () => ({ async adoptTaskSession() { return false } })
  })

  await controller.reconciliation
  assert.equal(store.current().status, "failed")
  assert.equal(store.current().error.message, "Task session is no longer available after daemon restart")
  assert.deepEqual(store.writes, ["failed"])
})

test("reconciliation preserves an active ACP task when session availability is ambiguous", async () => {
  const store = mutableStore(activeTask())
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: { async inspectRun() { return "unknown" } },
    acpService: () => ({ async adoptTaskSession() { return null } })
  })

  await controller.reconciliation
  assert.equal(store.current().status, "running")
  assert.equal(store.current().run.id, "run-1")
  assert.deepEqual(store.writes, [])
})

test("temporary HTTP run inspection failure does not fail or duplicate an active Task", async () => {
  const store = mutableStore(activeTask({
    agentId: "opencode",
    run: { id: "run-http-1", sessionId: "session-http-1", transport: "http", directory: "/tmp/task-1" }
  }))
  let inspections = 0
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async inspectRun() {
        inspections += 1
        throw new Error("machine temporarily offline")
      }
    }
  })

  await controller.reconciliation
  assert.equal(inspections, 1)
  assert.equal(store.current().status, "running")
  assert.equal(store.current().run.id, "run-http-1")
  assert.deepEqual(store.writes, [])
})

test("reconciliation keeps one persisted Run identity when an HTTP session state is unknown", async () => {
  const store = mutableStore(activeTask({
    agentId: "opencode",
    run: { id: "run-http-1", sessionId: "session-http-1", transport: "http", directory: "/tmp/task-1" }
  }))
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: { async inspectRun() { return "unknown" } }
  })

  await controller.reconciliation
  assert.equal(store.current().status, "running")
  assert.deepEqual(store.current().run, {
    id: "run-http-1",
    sessionId: "session-http-1",
    transport: "http",
    directory: "/tmp/task-1"
  })
  assert.deepEqual(store.writes, [])
})
