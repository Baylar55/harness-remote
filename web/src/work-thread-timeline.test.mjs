import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkThreadTimeline } from "./work-thread-timeline.ts"

function message(sessionID, id, role, created, text) {
  return {
    info: { id, sessionID, role, time: { created } },
    parts: [{ id: `${id}:text`, messageID: id, type: "text", text }]
  }
}

function run(overrides = {}) {
  return {
    id: "run-1",
    sequence: 1,
    agentId: "codex",
    model: { providerID: "openai", modelID: "gpt-test" },
    sessionId: "session-codex",
    status: "completed",
    transport: "acp",
    directory: "/repo-task",
    prompt: "Initial request",
    startedAt: "2026-08-21T10:00:00.000Z",
    finishedAt: "2026-08-21T10:01:00.000Z",
    ...overrides
  }
}

function task(overrides = {}) {
  const firstRun = run()
  return {
    id: "task-1",
    machineId: "machine-1",
    projectId: "project-1",
    project: { name: "Harness Remote", path: "/repo", kind: "git" },
    agentId: "codex",
    prompt: "Initial request",
    model: { providerID: "openai", modelID: "gpt-test" },
    status: "completed",
    workspace: { mode: "worktree", path: "/repo-task" },
    run: firstRun,
    runs: [firstRun],
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:01:00.000Z",
    ...overrides
  }
}

const agents = {
  codex: { label: "Codex", backend: "codex" },
  claude: { label: "Claude", backend: "claude" }
}

function textOf(entry) {
  return entry.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")
}

test("Work Thread timeline keeps complete history across native Sessions", () => {
  const first = run()
  const second = run({
    id: "run-2",
    sequence: 2,
    prompt: "Now add the tests",
    sessionId: "session-codex-2",
    startedAt: "2026-08-21T10:02:00.000Z",
    finishedAt: "2026-08-21T10:03:00.000Z"
  })
  const value = task({ run: second, runs: [first, second], updatedAt: second.finishedAt })
  const timeline = buildWorkThreadTimeline(value, {
    "session-codex": [
      message("session-codex", "u1", "user", Date.parse(first.startedAt) + 1, first.prompt),
      message("session-codex", "a1", "assistant", Date.parse(first.startedAt) + 20_000, "Implemented the first change")
    ],
    "session-codex-2": [
      message("session-codex-2", "u2", "user", Date.parse(second.startedAt) + 1, second.prompt),
      message("session-codex-2", "a2", "assistant", Date.parse(second.startedAt) + 20_000, "Added regression tests")
    ]
  }, agents)

  assert.deepEqual(timeline.map((entry) => [entry.info.role, textOf(entry)]), [
    ["user", "Initial request"],
    ["assistant", "Implemented the first change"],
    ["user", "Now add the tests"],
    ["assistant", "Added regression tests"]
  ])
})

test("same native Session reused for many turns is sliced by persisted run windows without duplicate prompts", () => {
  const first = run({ sessionId: "same-session" })
  const second = run({
    id: "run-2",
    sequence: 2,
    prompt: "Please refine that",
    sessionId: "same-session",
    startedAt: "2026-08-21T10:02:00.000Z",
    finishedAt: "2026-08-21T10:03:00.000Z"
  })
  const value = task({ run: second, runs: [first, second] })
  const native = [
    message("same-session", "u1", "user", Date.parse(first.startedAt) + 1, first.prompt),
    message("same-session", "a1", "assistant", Date.parse(first.startedAt) + 10_000, "First answer"),
    message("same-session", "u2", "user", Date.parse(second.startedAt) + 1, second.prompt),
    message("same-session", "a2", "assistant", Date.parse(second.startedAt) + 10_000, "Second answer")
  ]
  const timeline = buildWorkThreadTimeline(value, { "same-session": native }, agents)

  assert.deepEqual(timeline.map(textOf), ["Initial request", "First answer", "Please refine that", "Second answer"])
  assert.equal(timeline.filter((entry) => entry.info.role === "user").length, 2)
})

test("cross-harness continuity packet is hidden and represented by a compact product event", () => {
  const first = run()
  const second = run({
    id: "run-2",
    sequence: 2,
    agentId: "claude",
    prompt: "Check the architecture too",
    sessionId: "session-claude",
    startedAt: "2026-08-21T10:02:00.000Z",
    finishedAt: "2026-08-21T10:03:00.000Z"
  })
  const value = task({ run: second, runs: [first, second] })
  const handoff = `You are taking over an existing TaskDesk task.\nThe context below was transferred by TaskDesk and is not native conversational memory.\nUSER INSTRUCTION\nCheck the architecture too`
  const timeline = buildWorkThreadTimeline(value, {
    "session-codex": [message("session-codex", "a1", "assistant", Date.parse(first.startedAt) + 10_000, "Codex result")],
    "session-claude": [
      message("session-claude", "u2", "user", Date.parse(second.startedAt) + 1, handoff),
      message("session-claude", "a2", "assistant", Date.parse(second.startedAt) + 10_000, "Claude result")
    ]
  }, agents)

  assert.equal(timeline.some((entry) => textOf(entry).includes("You are taking over an existing TaskDesk task")), false)
  assert.equal(timeline.some((entry) => entry.info.role === "taskdesk" && textOf(entry) === "Switched to Claude · context transferred"), true)
  assert.equal(timeline.some((entry) => entry.info.role === "user" && textOf(entry) === second.prompt), true)
})

test("Codex to Claude to Codex resumes the prior harness in chronological Work Thread order", () => {
  const first = run()
  const second = run({
    id: "run-2", sequence: 2, agentId: "claude", prompt: "Have Claude review it", sessionId: "session-claude",
    startedAt: "2026-08-21T10:02:00.000Z", finishedAt: "2026-08-21T10:03:00.000Z"
  })
  const third = run({
    id: "run-3", sequence: 3, prompt: "Back to Codex for the fix", sessionId: "session-codex",
    startedAt: "2026-08-21T10:04:00.000Z", finishedAt: "2026-08-21T10:05:00.000Z"
  })
  const value = task({ run: third, runs: [first, second, third] })
  const timeline = buildWorkThreadTimeline(value, {
    "session-codex": [
      message("session-codex", "a1", "assistant", Date.parse(first.startedAt) + 10_000, "Codex first"),
      message("session-codex", "u3", "user", Date.parse(third.startedAt) + 1, third.prompt),
      message("session-codex", "a3", "assistant", Date.parse(third.startedAt) + 10_000, "Codex final")
    ],
    "session-claude": [message("session-claude", "a2", "assistant", Date.parse(second.startedAt) + 10_000, "Claude review")]
  }, agents)

  const texts = timeline.map(textOf)
  assert.deepEqual(texts.filter(Boolean), [
    "Initial request",
    "Codex first",
    "Switched to Claude · context transferred",
    "Have Claude review it",
    "Claude review",
    "Resumed Codex · context transferred",
    "Back to Codex for the fix",
    "Codex final"
  ])
})

test("persisted outcome fills old Work Thread history when a native Session can no longer be read", () => {
  const first = run({ outcome: "Persisted result from the old backend" })
  const value = task({ run: first, runs: [first] })
  const timeline = buildWorkThreadTimeline(value, {}, agents)

  assert.deepEqual(timeline.map((entry) => [entry.info.role, textOf(entry)]), [
    ["user", "Initial request"],
    ["assistant", "Persisted result from the old backend"]
  ])
  assert.equal(timeline[1].taskdesk.kind, "fallback-result")
})
