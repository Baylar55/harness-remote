import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { createTaskLaunchServer, launchStatus } from "../src/task-launch-server.js"

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

test("POST launch returns the persisted running task", async () => {
  const innerServer = new EventEmitter()
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: { async launch(id) { return { id, status: "running", run: { sessionId: "session-1" } } } }
  })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/launch`, { method: "POST" })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).run.sessionId, "session-1")
  } finally {
    await close(server)
  }
})

test("POST continue forwards prompt, harness, model and role", async () => {
  const innerServer = new EventEmitter()
  const calls = []
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: {
      async continue(id, options) {
        calls.push([id, options])
        return { id, status: "running", run: { id: "run-2", sessionId: "session-2", prompt: options.prompt } }
      }
    }
  })
  const port = await listen(server)
  try {
    const body = {
      prompt: "Review the implementation",
      agentId: "claude",
      model: { providerID: "anthropic", modelID: "claude-test" },
      role: "review"
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).run.sessionId, "session-2")
    assert.deepEqual(calls, [["task-1", body]])
  } finally {
    await close(server)
  }
})

test("GET context returns an inspectable Task Context preview", async () => {
  const innerServer = new EventEmitter()
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: {
      async context(id) {
        return { version: 1, revision: 2, taskId: id, objective: "Implement OAuth", changedFiles: ["src/auth.js"] }
      }
    }
  })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/context`)
    assert.equal(response.status, 200)
    const context = await response.json()
    assert.equal(context.taskId, "task-1")
    assert.equal(context.revision, 2)
    assert.deepEqual(context.changedFiles, ["src/auth.js"])
  } finally {
    await close(server)
  }
})

test("launch maps coded missing tasks to 404 and delegates unrelated routes", async () => {
  const innerServer = new EventEmitter()
  let delegated = false
  innerServer.on("request", (_request, response) => {
    delegated = true
    response.writeHead(204)
    response.end()
  })
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: { async launch(id) { const error = new Error(`Unknown task: ${id}`); error.code = "unknown_task"; throw error } }
  })
  const port = await listen(server)
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/v1/tasks/missing/launch`, { method: "POST" })
    assert.equal(missing.status, 404)
    const delegatedResponse = await fetch(`http://127.0.0.1:${port}/v1/tasks`)
    assert.equal(delegatedResponse.status, 204)
    assert.equal(delegated, true)
  } finally {
    await close(server)
  }
})

test("launch status maps unavailable native Session to a conflict", () => {
  const error = new Error("Session unavailable")
  error.code = "session_unavailable"
  assert.equal(launchStatus(error), 409)
})

test("launch status ignores prose when no structured code is present", () => {
  assert.equal(launchStatus(new Error("unknown task worktree unavailable")), 500)
})

test("worktree inspection and cleanup use explicit task lifecycle actions", async () => {
  const innerServer = new EventEmitter()
  const calls = []
  const server = createTaskLaunchServer({
    innerServer,
    config: { username: "", password: "", corsOrigins: [] },
    taskRunController: {
      async inspectWorkspace(id) { calls.push(["inspect", id]); return { managed: true, dirty: false, changeCount: 0, changedFiles: [] } },
      async cleanupWorkspace(id) { calls.push(["cleanup", id]); return { task: { id }, cleanup: { removed: true, branchDeleted: false } } }
    }
  })
  const port = await listen(server)
  try {
    const inspected = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/worktree`)
    assert.equal(inspected.status, 200)
    assert.equal((await inspected.json()).managed, true)
    const cleaned = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/worktree/cleanup`, { method: "POST" })
    assert.equal(cleaned.status, 200)
    assert.equal((await cleaned.json()).cleanup.removed, true)
    assert.deepEqual(calls, [["inspect", "task-1"], ["cleanup", "task-1"]])
  } finally {
    await close(server)
  }
})

test("existing POST worktree preparation still delegates unchanged", async () => {
  const innerServer = new EventEmitter()
  let delegated = false
  innerServer.on("request", (_request, response) => {
    delegated = true
    response.writeHead(204)
    response.end()
  })
  const server = createTaskLaunchServer({ innerServer, config: { username: "", password: "", corsOrigins: [] }, taskRunController: {} })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tasks/task-1/worktree`, { method: "POST" })
    assert.equal(response.status, 204)
    assert.equal(delegated, true)
  } finally {
    await close(server)
  }
})
