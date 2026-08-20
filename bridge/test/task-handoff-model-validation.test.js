import assert from "node:assert/strict"
import test from "node:test"
import { launchStatus } from "../src/task-launch-server.js"
import { TaskRunController } from "../src/task-run-controller.js"

function completedTask() {
  const run = {
    id: "run-1",
    sequence: 1,
    agentId: "codex",
    model: { providerID: "openai", modelID: "gpt-old" },
    sessionId: "codex-1",
    transport: "acp",
    status: "completed",
    prompt: "Implement it",
    finishedAt: "2026-08-20T09:00:00.000Z"
  }
  return {
    id: "task-1",
    status: "completed",
    agentId: "codex",
    model: run.model,
    prompt: "Implement it",
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "project", path: "/repo" },
    run,
    runs: [run],
    context: { version: 1, revision: 1 }
  }
}

test("Continue validates the selected target model before persisting a new Run", async () => {
  const task = completedTask()
  let writes = 0
  const error = new Error("Selected model is no longer available: anthropic/removed")
  error.code = "model_unavailable"
  const controller = new TaskRunController({
    taskStore: {
      async list() { return [] },
      async get() { return structuredClone(task) },
      async setRunState() { writes += 1; throw new Error("must not persist") }
    },
    taskLauncher: {
      async validateModelSelection(agentID, model) {
        assert.equal(agentID, "claude")
        assert.deepEqual(model, { providerID: "anthropic", modelID: "removed" })
        throw error
      }
    }
  })

  await assert.rejects(
    () => controller.continue("task-1", {
      prompt: "Review the implementation",
      agentId: "claude",
      model: { providerID: "anthropic", modelID: "removed" },
      role: "review"
    }),
    (failure) => failure.code === "model_unavailable"
  )
  assert.equal(writes, 0)
})

test("model_unavailable is a stable handoff conflict instead of a generic server error", () => {
  const error = new Error("model unavailable")
  error.code = "model_unavailable"
  assert.equal(launchStatus(error), 409)
})
