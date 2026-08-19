import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"

test("reconciliation fails an active ACP task when its saved session no longer exists", async () => {
  let current = {
    id: "task-1",
    status: "running",
    agentId: "pi",
    prompt: "Do work",
    workspace: { mode: "worktree", path: "/tmp/task-1" },
    run: { id: "run-1", sessionId: "session-1", transport: "acp", directory: "/tmp/task-1" }
  }
  const store = {
    async list() { return [structuredClone(current)] },
    async setRunState(_id, update) {
      current = {
        ...current,
        status: update.status,
        run: structuredClone(update.run ?? current.run),
        error: update.error ? { message: update.error.message } : null
      }
      return structuredClone(current)
    }
  }
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: { async inspectRun() { throw new Error("should not inspect a missing ACP session") } },
    acpService: () => ({ async adoptTaskSession() { return false } })
  })

  await controller.reconciliation
  assert.equal(current.status, "failed")
  assert.equal(current.error.message, "Task session is no longer available after daemon restart")
})
