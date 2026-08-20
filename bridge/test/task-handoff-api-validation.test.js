import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { createTaskLaunchServer } from "../src/task-launch-server.js"
import { TaskRunController } from "../src/task-run-controller.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server.address().port
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

function completedTask() {
  const run = {
    id: "run-1",
    sequence: 1,
    agentId: "codex",
    sessionId: "codex-1",
    transport: "acp",
    status: "completed",
    prompt: "Fix it",
    finishedAt: "2026-08-20T08:00:00.000Z"
  }
  return {
    id: "task-1",
    status: "completed",
    agentId: "codex",
    prompt: "Fix it",
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "project", path: "/repo" },
    run,
    runs: [run],
    context: { version: 1, revision: 1 }
  }
}

test("Continue rejects malformed model and unsupported execution mode with stable request errors", async () => {
  const task = completedTask()
  const controller = new TaskRunController({
    taskStore: { async list() { return [] }, async get() { return structuredClone(task) } },
    taskLauncher: {}
  })

  await assert.rejects(
    () => controller.continue("task-1", { prompt: "Continue", model: { providerID: "openai" } }),
    (error) => error.code === "invalid_request" && /model is malformed/.test(error.message)
  )
  await assert.rejects(
    () => controller.continue("task-1", { prompt: "Continue", mode: "magic" }),
    (error) => error.code === "invalid_request" && /mode must be fresh or resume/.test(error.message)
  )
})

test("legacy string Continue remains accepted", async () => {
  let current = completedTask()
  const controller = new TaskRunController({
    taskStore: {
      async list() { return [] },
      async get() { return structuredClone(current) },
      async setRunState(_id, update) {
        current = { ...current, status: update.status, run: structuredClone(update.run) }
        return structuredClone(current)
      }
    },
    taskLauncher: {
      async resumeSession(_task, previousRun) { return { sessionId: previousRun.sessionId, transport: "acp", directory: "/repo" } },
      async startPrompt() {}
    },
    runIDFactory: () => "run-2"
  })

  const continued = await controller.continue("task-1", "Continue with the existing fix")
  assert.equal(continued.run.id, "run-2")
  assert.equal(continued.run.sessionId, "codex-1")
  assert.equal(continued.run.prompt, "Continue with the existing fix")
})

test("task handoff HTTP API returns 400 for malformed JSON and non-object bodies", async () => {
  const innerServer = new EventEmitter()
  let calls = 0
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: { async continue() { calls += 1; return {} } }
  })
  const port = await listen(server)
  try {
    const malformed = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON", code: "invalid_request" })

    const arrayBody = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]"
    })
    assert.equal(arrayBody.status, 400)
    assert.deepEqual(await arrayBody.json(), { error: "Request body must be a JSON object", code: "invalid_request" })
    assert.equal(calls, 0)
  } finally {
    await close(server)
  }
})
