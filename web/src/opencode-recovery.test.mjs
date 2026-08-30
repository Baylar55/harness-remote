import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkThreadTimeline } from "./work-thread-timeline.ts"

function message(id, role, text, error) {
  return {
    info: {
      id,
      sessionID: "session-opencode",
      role,
      time: { created: Number(id.replace(/\D/g, "")) || 1 },
      ...(error ? { error: { name: "ResponseInterrupted", message: error } } : {})
    },
    parts: text ? [{ id: `${id}:text`, messageID: id, type: "text", text }] : []
  }
}

function task(status = "completed") {
  const run = {
    id: "run-1",
    sequence: 1,
    agentId: "opencode",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    sessionId: "session-opencode",
    status,
    transport: "http",
    directory: "/repo",
    prompt: "Explain the change",
    startedAt: "2026-08-25T16:00:00.000Z",
    finishedAt: status === "completed" ? "2026-08-25T16:01:00.000Z" : undefined
  }
  return {
    id: "task-opencode",
    machineId: "machine-1",
    projectId: "project-1",
    project: { name: "Harness Remote", path: "/repo", kind: "git" },
    agentId: "opencode",
    prompt: run.prompt,
    model: run.model,
    status,
    workspace: { mode: "inplace", path: "/repo" },
    run,
    runs: [run],
    createdAt: run.startedAt,
    updatedAt: run.finishedAt || run.startedAt
  }
}

const agents = { opencode: { label: "OpenCode", backend: "opencode" } }

test("a later successful OpenCode assistant envelope clears an earlier interrupted attempt", () => {
  const timeline = buildWorkThreadTimeline(task(), {
    "session-opencode": [
      message("u1", "user", "Explain the change"),
      message("a2", "assistant", undefined, "response interrupted"),
      message("a3", "assistant", "The response recovered and completed normally.")
    ]
  }, agents)
  const assistant = timeline.find((entry) => entry.info.role === "assistant")
  assert.equal(assistant.info.error, undefined)
  assert.equal(assistant.parts.some((part) => part.type === "text" && part.text.includes("recovered")), true)
})

test("a genuinely terminal OpenCode interruption remains visible", () => {
  const timeline = buildWorkThreadTimeline(task("failed"), {
    "session-opencode": [
      message("u1", "user", "Explain the change"),
      message("a2", "assistant", undefined, "response interrupted")
    ]
  }, agents)
  const assistant = timeline.find((entry) => entry.info.role === "assistant")
  assert.equal(assistant.info.error?.message, "response interrupted")
})
