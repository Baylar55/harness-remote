import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkThreadTimeline } from "./work-thread-timeline.ts"

function message(sessionID, id, role, created, text) {
  return {
    info: { id, sessionID, role, time: { created } },
    parts: [{ id: `${id}:text`, messageID: id, type: "text", text }]
  }
}

test("a delayed assistant reply stays attached to the Run whose prompt opened the native turn", () => {
  const startedAt = "2026-08-21T10:00:00.000Z"
  const finishedAt = "2026-08-21T10:01:00.000Z"
  const run = {
    id: "run-1",
    sequence: 1,
    agentId: "omp",
    model: { providerID: "openai", modelID: "slow-model" },
    sessionId: "session-omp",
    status: "completed",
    transport: "acp",
    directory: "/repo-task",
    prompt: "Do a long audit",
    startedAt,
    finishedAt
  }
  const task = {
    id: "task-1",
    machineId: "machine-1",
    projectId: "project-1",
    project: { name: "Harness Remote", path: "/repo", kind: "git" },
    agentId: "omp",
    prompt: run.prompt,
    model: run.model,
    status: "completed",
    workspace: { mode: "worktree", path: "/repo-task" },
    run,
    runs: [run],
    createdAt: startedAt,
    updatedAt: finishedAt
  }
  const start = Date.parse(startedAt)
  const late = Date.parse(finishedAt) + 45_000
  const timeline = buildWorkThreadTimeline(task, {
    "session-omp": [
      message("session-omp", "user-1", "user", start + 1, run.prompt),
      message("session-omp", "assistant-1", "assistant", start + 20_000, "First part"),
      message("session-omp", "assistant-2", "assistant", late, "Delayed final part")
    ]
  }, { omp: { label: "Oh My Pi", backend: "omp" } })

  assert.deepEqual(
    timeline.map((entry) => [entry.info.role, entry.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")]),
    [
      ["user", "Do a long audit"],
      ["assistant", "First part"],
      ["assistant", "Delayed final part"]
    ]
  )
  assert.ok(timeline[2].info.time.created < Date.parse(finishedAt) + 5_000, "late replay timing should be normalized inside the historical Run")
})

test("an unrelated native-session turn is not silently absorbed into the Task", () => {
  const startedAt = "2026-08-21T10:00:00.000Z"
  const finishedAt = "2026-08-21T10:01:00.000Z"
  const run = {
    id: "run-1",
    sequence: 1,
    agentId: "omp",
    sessionId: "session-omp",
    status: "completed",
    transport: "acp",
    directory: "/repo-task",
    prompt: "TaskDesk request",
    startedAt,
    finishedAt
  }
  const task = {
    id: "task-1",
    machineId: "machine-1",
    projectId: "project-1",
    agentId: "omp",
    prompt: run.prompt,
    status: "completed",
    workspace: { mode: "worktree", path: "/repo-task" },
    run,
    runs: [run],
    createdAt: startedAt,
    updatedAt: finishedAt
  }
  const start = Date.parse(startedAt)
  const timeline = buildWorkThreadTimeline(task, {
    "session-omp": [
      message("session-omp", "user-task", "user", start + 1, run.prompt),
      message("session-omp", "assistant-task", "assistant", start + 5_000, "Task answer"),
      message("session-omp", "user-manual", "user", start + 120_000, "Manual native-session question"),
      message("session-omp", "assistant-manual", "assistant", start + 125_000, "Manual native answer")
    ]
  }, { omp: { label: "Oh My Pi", backend: "omp" } })

  const text = timeline.flatMap((entry) => entry.parts.filter((part) => part.type === "text").map((part) => part.text))
  assert.deepEqual(text, ["TaskDesk request", "Task answer"])
})
