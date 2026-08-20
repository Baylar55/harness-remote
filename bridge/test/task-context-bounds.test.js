import assert from "node:assert/strict"
import test from "node:test"
import { buildPersistedTaskContext, buildTaskContext, formatTaskHandoff } from "../src/task-context.js"

function largeTask(runCount = 40) {
  const runs = Array.from({ length: runCount }, (_, index) => ({
    id: `run-${index + 1}`,
    sequence: index + 1,
    agentId: index % 2 === 0 ? "codex" : "claude",
    role: index % 2 === 0 ? "implement" : "review",
    sessionId: `session-${index + 1}`,
    status: "completed",
    prompt: `prompt-${index + 1}:` + "p".repeat(5_000),
    outcome: `outcome-${index + 1}:` + "o".repeat(10_000),
    finishedAt: `2026-08-20T09:${String(index).padStart(2, "0")}:00.000Z`
  }))
  return {
    id: "task-bounded",
    status: "completed",
    prompt: "objective:" + "x".repeat(20_000),
    run: runs.at(-1),
    runs,
    error: null,
    context: { version: 1, revision: runCount }
  }
}

test("persisted Task Context keeps only bounded recent Run summaries", () => {
  const context = buildPersistedTaskContext(largeTask(), 40)

  assert.equal(context.runCount, 40)
  assert.equal(context.runSummaries.length, 12)
  assert.equal(context.runSummaries[0].sequence, 29)
  assert.equal(context.runSummaries.at(-1).sequence, 40)
  assert.equal(context.objective.length <= 12_000, true)
  for (const run of context.runSummaries) {
    assert.equal(run.prompt.length <= 2_000, true)
    assert.equal(run.outcome.length <= 6_000, true)
  }
})

test("Task Context bounds changed-file names while preserving total change count", () => {
  const changedFiles = Array.from({ length: 120 }, (_, index) => `src/${index}-${"x".repeat(600)}.js`)
  const context = buildTaskContext(largeTask(2), {
    workspace: { dirty: true, changeCount: changedFiles.length, changedFiles }
  })

  assert.equal(context.changedFiles.length, 80)
  assert.equal(context.workspace.changeCount, 120)
  assert.equal(context.workspace.listedChangeCount, 80)
  assert.equal(context.workspace.truncated, true)
  assert.equal(context.changedFiles.every((file) => file.length <= 500), true)
})

test("handoff packet uses recent bounded history instead of replaying the whole Task", () => {
  const context = buildTaskContext(largeTask(40), {
    workspace: { dirty: false, changeCount: 0, changedFiles: [] }
  })
  const handoff = formatTaskHandoff(context, {
    targetAgentId: "pi",
    role: "test",
    instruction: "Run the focused regression suite"
  })

  assert.match(handoff, /Run 40:/)
  assert.doesNotMatch(handoff, /Run 1:/)
  assert.match(handoff, /28 earlier Task step\(s\) retained in Task history but omitted from this handoff/)
  assert.match(handoff, /USER INSTRUCTION\nRun the focused regression suite/)
  assert.equal(handoff.length < 60_000, true)
})
