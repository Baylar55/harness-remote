import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"

function taskWithRuns(runs, overrides = {}) {
  return {
    id: "task-1",
    status: "completed",
    agentId: "codex",
    prompt: "Implement the feature",
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "project", path: "/repo" },
    run: runs.at(-1),
    runs,
    error: null,
    context: { version: 1, revision: runs.length },
    ...overrides
  }
}

function completedRun(id, sequence, agentId, sessionId) {
  return {
    id,
    sequence,
    agentId,
    sessionId,
    transport: agentId === "opencode" ? "http" : "acp",
    role: "continue",
    prompt: `Run ${sequence}`,
    status: "completed",
    finishedAt: `2026-08-20T09:0${sequence}:00.000Z`
  }
}

function inMemoryStore(initial) {
  let current = structuredClone(initial)
  return {
    get current() { return current },
    async list() { return [] },
    async get() { return structuredClone(current) },
    async setRunState(_id, update) {
      const nextRun = structuredClone(update.run ?? current.run)
      const runs = current.runs.map((run) => structuredClone(run))
      if (nextRun?.id) {
        const index = runs.findIndex((run) => run.id === nextRun.id)
        if (index >= 0) runs[index] = nextRun
        else runs.push(nextRun)
      }
      current = { ...current, status: update.status, run: nextRun, runs }
      return structuredClone(current)
    }
  }
}

test("returning to a harness selects its most recent native Session", async () => {
  const runs = [
    completedRun("run-1", 1, "codex", "codex-old"),
    completedRun("run-2", 2, "claude", "claude-1"),
    completedRun("run-3", 3, "codex", "codex-new"),
    completedRun("run-4", 4, "pi", "pi-1")
  ]
  const store = inMemoryStore(taskWithRuns(runs))
  let resumedFrom
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async resumeSession(_task, previousRun) {
        resumedFrom = structuredClone(previousRun)
        return { sessionId: previousRun.sessionId, transport: "acp", directory: "/repo" }
      },
      async startPrompt() {}
    },
    runIDFactory: () => "run-5"
  })

  const continued = await controller.continue("task-1", { prompt: "Fix PI findings", agentId: "codex", role: "fix" })
  assert.equal(resumedFrom.id, "run-3")
  assert.equal(resumedFrom.sessionId, "codex-new")
  assert.equal(continued.run.sessionId, "codex-new")
  assert.equal(continued.run.resumedFromRunId, "run-3")
})

test("explicit fresh mode always creates a new Session even for the same harness", async () => {
  const runs = [completedRun("run-1", 1, "codex", "codex-old")]
  const store = inMemoryStore(taskWithRuns(runs))
  let creates = 0
  let resumes = 0
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async createSession() {
        creates += 1
        return { sessionId: "codex-fresh", transport: "acp", directory: "/repo" }
      },
      async resumeSession() { resumes += 1; throw new Error("must not resume") },
      async startPrompt() {}
    },
    runIDFactory: () => "run-2"
  })

  const continued = await controller.continue("task-1", {
    prompt: "Retry from a fresh context",
    agentId: "codex",
    mode: "fresh"
  })
  assert.equal(creates, 1)
  assert.equal(resumes, 0)
  assert.equal(continued.run.sessionId, "codex-fresh")
  assert.equal(Object.hasOwn(continued.run, "resumedFromRunId"), false)
})

test("ephemeral HTTP credentials are never persisted into Task Run history", async () => {
  const runs = [completedRun("run-1", 1, "opencode", "http-old")]
  const store = inMemoryStore(taskWithRuns(runs, { agentId: "opencode" }))
  let runtimeSession
  const controller = new TaskRunController({
    taskStore: store,
    taskLauncher: {
      async resumeSession() {
        return {
          sessionId: "http-old",
          transport: "http",
          directory: "/repo",
          base: "http://127.0.0.1:4096",
          authorization: "Basic dXNlcjpzZWNyZXQ="
        }
      },
      async startPrompt(_task, session) { runtimeSession = structuredClone(session) }
    },
    runIDFactory: () => "run-2"
  })

  const continued = await controller.continue("task-1", { prompt: "Continue", agentId: "opencode" })
  assert.equal(runtimeSession.authorization, "Basic dXNlcjpzZWNyZXQ=")
  assert.equal(runtimeSession.base, "http://127.0.0.1:4096")
  assert.equal(Object.hasOwn(continued.run, "authorization"), false)
  assert.equal(Object.hasOwn(continued.run, "base"), false)
  assert.equal(Object.hasOwn(store.current.run, "authorization"), false)
  assert.equal(Object.hasOwn(store.current.runs.at(-1), "authorization"), false)
})
