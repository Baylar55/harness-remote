import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"

function chain({ status = "completed", current = "claude" } = {}) {
  const runs = [
    {
      id: "run-1",
      sequence: 1,
      agentId: "codex",
      role: "implement",
      sessionId: "codex-session-a",
      transport: "acp",
      directory: "/repo",
      prompt: "Implement OAuth login",
      outcome: "OAuth implementation complete.",
      status: "completed",
      finishedAt: "2026-08-20T08:01:00.000Z"
    },
    {
      id: "run-2",
      sequence: 2,
      agentId: "claude",
      role: "review",
      sessionId: "claude-session-b",
      transport: "acp",
      directory: "/repo",
      prompt: "Review the implementation",
      outcome: "Review found a refresh-token issue.",
      status: current === "claude" ? status : "completed",
      ...(current === "claude" && ["starting", "running"].includes(status) ? {} : { finishedAt: "2026-08-20T08:02:00.000Z" })
    },
    {
      id: "run-3",
      sequence: 3,
      agentId: "pi",
      role: "test",
      sessionId: "pi-session-c",
      transport: "acp",
      directory: "/repo",
      prompt: "Run tests",
      outcome: "One auth regression is failing.",
      status: current === "pi" ? status : "completed",
      ...(current === "pi" && ["starting", "running"].includes(status) ? {} : { finishedAt: "2026-08-20T08:03:00.000Z" })
    }
  ]
  const selected = current === "pi" ? runs[2] : runs[1]
  const keptRuns = current === "pi" ? runs : runs.slice(0, 2)
  return {
    id: "task-1",
    machineId: "machine-1",
    project: { kind: "git", path: "/repo" },
    agentId: "codex",
    prompt: "Implement OAuth login",
    status,
    workspace: { mode: "project", path: "/repo" },
    run: selected,
    runs: keptRuns,
    error: null,
    context: { version: 1, revision: keptRuns.filter((run) => run.finishedAt).length }
  }
}

function storeFor(initial) {
  let current = structuredClone(initial)
  const writes = []
  return {
    get current() { return current },
    writes,
    async list() { return [structuredClone(current)] },
    async get() { return structuredClone(current) },
    async setRunState(_taskID, update) {
      writes.push(structuredClone({ status: update.status, run: update.run, expectedRunId: update.expectedRunId, error: update.error?.message }))
      if (update.expectedRunId !== undefined && current.run?.id !== update.expectedRunId) return structuredClone(current)
      const nextRun = structuredClone(update.run ?? current.run)
      const runs = current.runs.map((run) => structuredClone(run))
      if (nextRun?.id) {
        const index = runs.findIndex((run) => run.id === nextRun.id)
        if (index >= 0) runs[index] = nextRun
        else runs.push(nextRun)
      }
      current = { ...current, status: update.status, run: nextRun, runs, error: update.error ? { message: update.error.message } : null }
      return structuredClone(current)
    }
  }
}

test("completed multi-harness history survives restart and can return to the earlier Codex Session", async () => {
  const store = storeFor(chain())
  let startupAdoptions = 0
  let resumedFrom = null
  let prompt = null
  const controller = new TaskRunController({
    taskStore: store,
    acpService: () => ({ async adoptTaskSession() { startupAdoptions += 1; return true } }),
    taskLauncher: {
      async resumeSession(task, previousRun) {
        resumedFrom = structuredClone(previousRun)
        prompt = task.prompt
        return { sessionId: previousRun.sessionId, transport: "acp", directory: "/repo" }
      },
      async createSession() { throw new Error("Codex Session A should be reused after restart") },
      async startPrompt(task) { prompt = task.prompt }
    },
    runIDFactory: () => "run-3-after-restart"
  })

  await controller.reconciliation
  assert.equal(startupAdoptions, 0, "completed historical Sessions should be adopted lazily, not at daemon startup")

  const continued = await controller.continue("task-1", {
    prompt: "Fix the Claude review finding",
    agentId: "codex",
    role: "fix"
  })

  assert.equal(resumedFrom.id, "run-1")
  assert.equal(resumedFrom.sessionId, "codex-session-a")
  assert.equal(continued.run.sessionId, "codex-session-a")
  assert.equal(continued.run.resumedFromRunId, "run-1")
  assert.equal(continued.run.handoffFromRunId, "run-2")
  assert.match(prompt, /Review found a refresh-token issue/)
  assert.match(prompt, /USER INSTRUCTION\nFix the Claude review finding/)
})

test("an active PI Run keeps the same Run and Session identity across ambiguous restart recovery", async () => {
  const store = storeFor(chain({ status: "running", current: "pi" }))
  const adopted = []
  const controller = new TaskRunController({
    taskStore: store,
    acpService: (agentID) => agentID === "pi" ? {
      async adoptTaskSession(sessionID) { adopted.push(sessionID); return true }
    } : undefined,
    taskLauncher: { async inspectRun() { return "unknown" } }
  })

  await controller.reconciliation
  assert.deepEqual(adopted, ["pi-session-c"])
  assert.equal(store.current.status, "running")
  assert.equal(store.current.run.id, "run-3")
  assert.equal(store.current.run.sessionId, "pi-session-c")
  assert.equal(store.writes.length, 0)
})

test("temporary current-harness unavailability does not fail or rewrite the active Task", async () => {
  const store = storeFor(chain({ status: "running", current: "claude" }))
  const controller = new TaskRunController({
    taskStore: store,
    acpService: () => undefined,
    taskLauncher: { async inspectRun() { return "unknown" } }
  })

  await controller.reconciliation
  assert.equal(store.current.status, "running")
  assert.equal(store.current.run.id, "run-2")
  assert.equal(store.current.run.sessionId, "claude-session-b")
  assert.equal(store.current.runs[0].sessionId, "codex-session-a")
  assert.equal(store.writes.length, 0)
})

test("a definitively missing current Session fails only that Run and preserves earlier harness history", async () => {
  const store = storeFor(chain({ status: "running", current: "claude" }))
  const controller = new TaskRunController({
    taskStore: store,
    acpService: (agentID) => agentID === "claude" ? {
      async adoptTaskSession() { return false }
    } : undefined,
    taskLauncher: { async inspectRun() { return "unknown" } }
  })

  await controller.reconciliation
  assert.equal(store.current.status, "failed")
  assert.equal(store.current.run.id, "run-2")
  assert.match(store.current.error.message, /no longer available after daemon restart/)
  assert.equal(store.current.runs[0].id, "run-1")
  assert.equal(store.current.runs[0].sessionId, "codex-session-a")
})
