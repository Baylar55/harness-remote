import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  agentLabel,
  modelLabel,
  normalizeTaskStatus,
  sortTasksByActivity,
  taskStatusLabel,
  taskTitle
} from "./taskdeskHomeModel.ts"

function task(overrides = {}) {
  return {
    id: "task-1",
    machineId: "machine-1",
    projectId: "project-1",
    project: { name: "Harness Remote", path: "/repo", kind: "git" },
    agentId: "codex",
    prompt: "Fix the authentication regression\nMore context",
    model: { providerID: "openai", modelID: "gpt-test", variant: "high" },
    status: "running",
    workspace: { mode: "worktree", path: "/repo-task" },
    run: null,
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T11:00:00.000Z",
    ...overrides
  }
}

test("legacy task status normalization remains compatible with persisted Work Threads", () => {
  assert.equal(normalizeTaskStatus("created"), "preparing")
  assert.equal(normalizeTaskStatus("pending"), "queued")
  assert.equal(normalizeTaskStatus("busy"), "running")
  assert.equal(normalizeTaskStatus("needs_attention"), "waiting")
  assert.equal(normalizeTaskStatus("succeeded"), "completed")
  assert.equal(normalizeTaskStatus("error"), "failed")
  assert.equal(normalizeTaskStatus("aborted"), "cancelled")
  assert.equal(normalizeTaskStatus("custom-state"), "unknown")
  assert.equal(taskStatusLabel("custom-state"), "custom-state")
})

test("legacy persisted records retain stable labels while the product calls them Work Threads", () => {
  const value = task()
  assert.equal(taskTitle(value), "Fix the authentication regression")
  assert.equal(modelLabel(value), "gpt-test · high")
  assert.equal(agentLabel([
    { id: "codex", label: "Codex CLI", backend: "codex", transport: "acp", managed: false, state: "available", capabilities: {} }
  ], value.agentId), "Codex CLI")
  assert.deepEqual(sortTasksByActivity([
    task({ id: "older", updatedAt: "2026-08-18T09:00:00.000Z" }),
    task({ id: "newer", updatedAt: "2026-08-18T12:00:00.000Z" })
  ]).map((item) => item.id), ["newer", "older"])
})

test("TaskDesk machine configuration remains independent from Classic profiles and activates Work Threads", () => {
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8")
  const machineStorage = readFileSync(new URL("./workspaceMachines.ts", import.meta.url), "utf8")
  const standalone = readFileSync(new URL("./components/standalone-universal-workspace.tsx", import.meta.url), "utf8")
  const taskDeskBoundary = main.match(/function TaskDeskBoundary\(\) \{[\s\S]*?\basync function renderApp/)

  assert.ok(taskDeskBoundary, "TaskDesk boundary should remain explicit")
  assert.match(taskDeskBoundary[0], /loadWorkspaceMachines/)
  assert.doesNotMatch(taskDeskBoundary[0], /loadServerProfiles/)
  assert.match(machineStorage, /harness-remote\.workspace\.machines\.v1/)
  assert.match(standalone, /import \{ TaskDeskWorkspace \} from "\.\/taskdesk-workspace"/)
  assert.match(standalone, /<TaskDeskWorkspace/)
  assert.doesNotMatch(standalone, /TaskDeskV3Unified/)
})

test("primary product surface is Project -> Work Thread -> Conversation, not Task -> Run -> Session", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const detail = readFileSync(new URL("./components/work-thread-detail.tsx", import.meta.url), "utf8")
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")

  assert.match(shell, /> Projects</)
  assert.match(shell, /> Work Threads</)
  assert.match(shell, /New Work Thread/)
  assert.match(shell, /<WorkThreadDetail/)
  assert.match(shell, /key=\{selected\.key\}/)
  assert.doesNotMatch(shell, /function latestSessionID/)
  assert.doesNotMatch(shell, /focusSessionRequest/)
  assert.doesNotMatch(shell, />Tasks</)
  assert.doesNotMatch(shell, />Runs</)
  assert.match(detail, />Conversation</)
  assert.match(detail, />Changes</)
  assert.match(detail, />Result</)
  assert.match(detail, />History/)
  assert.match(detail, /<WorkThreadConversation/)
  assert.match(conversation, /<TaskDeskConversation/)
  assert.match(conversation, /buildWorkThreadTimeline/)
})

test("New Work Thread starts immediately selected and invalidates stale machine refreshes", () => {
  const source = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")

  assert.match(source, /taskClient\.createTask/)
  assert.match(source, /taskClient\.prepareWorktree/)
  assert.match(source, /label: "Before work began"/)
  assert.match(source, /kind: "baseline"/)
  assert.match(source, /taskClient\.launch/)
  assert.match(source, /refreshGeneration\.current \+= 1/)
  assert.match(source, /setSelectedThreadKey\(`\$\{runtime\.machine\.id\}:\$\{task\.id\}`\)/)
})

test("Work Thread composer continues through product lifecycle and can switch agent/model", () => {
  const source = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const client = readFileSync(new URL("./taskClient.ts", import.meta.url), "utf8")

  assert.match(source, /taskClient\.getWorkThread\(baseConfig, task\.id\)/)
  assert.match(source, /taskClient\.continueTask\(baseConfig, task\.id, \{/)
  assert.match(source, /agentId: targetAgentID/)
  assert.match(source, /providerID: selectedModel\.providerID/)
  assert.match(source, /modelID: selectedModel\.modelID/)
  assert.match(source, /taskClient\.listAgentModels/)
  assert.match(client, /mode\?: "fresh" \| "resume"/)
  assert.match(client, /\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/continue/)
})

test("Working state is reconciled from the real native session and the chat exposes Stop plus waiting feedback", () => {
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const shared = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")
  const server = readFileSync(new URL("../../bridge/src/work-thread-controller.js", import.meta.url), "utf8")
  const abort = readFileSync(new URL("../../bridge/src/work-thread-abort.js", import.meta.url), "utf8")

  assert.match(conversation, /ACTIVE_RECONCILE_MS = 1_000/)
  assert.match(conversation, /waiting=\{working\}/)
  assert.match(conversation, /onStop=\{working \? stop : undefined\}/)
  assert.match(shared, /className="uw-session-typing" role="status"/)
  assert.match(shared, /workingLabel/)
  assert.match(shared, /waiting && onStop/)
  assert.match(shared, /className="uw-button uw-button-danger"/)
  assert.match(shared, /stopping \? "Stopping" : "Stop"/)
  assert.match(server, /service\.status\(sessionID\(task\.run\)\)/)
  assert.match(server, /await abortWorkThreadRun\(task, this\.taskRunController\)/)
  assert.match(abort, /service\.abort\(sessionID\)/)
  assert.match(abort, /\/abort\?directory=/)
})

test("real native questions and permissions appear in the Work Thread rather than a permanent Needs You navigation pillar", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const attention = readFileSync(new URL("./components/work-thread-attention.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(shell, />Needs You</)
  assert.match(conversation, /api\.loadQuestions/)
  assert.match(conversation, /api\.loadPermissions/)
  assert.match(conversation, /request\.sessionID === session/)
  assert.match(attention, /api\.replyQuestion/)
  assert.match(attention, /api\.replyPermission/)
})

test("Changes Result History checkpoint and Restore are first-class Work Thread surfaces", () => {
  const detail = readFileSync(new URL("./components/work-thread-detail.tsx", import.meta.url), "utf8")
  const client = readFileSync(new URL("./taskClient.ts", import.meta.url), "utf8")
  const checkpoints = readFileSync(new URL("../../bridge/src/work-thread-checkpoints.js", import.meta.url), "utf8")

  assert.match(detail, /taskClient\.inspectWorkspace/)
  assert.match(detail, /api\.loadDiff/)
  assert.match(detail, /taskClient\.finish/)
  assert.match(detail, /Save checkpoint/)
  assert.match(detail, /Restore this version/)
  assert.match(detail, /taskClient\.restoreCheckpoint/)
  assert.match(client, /\/v1\/work-threads\/\$\{encodeURIComponent\(taskId\)\}\/checkpoints/)
  assert.match(checkpoints, /git.*stash.*create|"stash", "create"/s)
  assert.match(checkpoints, /"restore", `--source=\$\{checkpoint\.commit\}`/)
})

test("Native Sessions remain available only as Advanced diagnostics in the normal TaskDesk shell", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")

  assert.match(shell, /Advanced: Native Sessions/)
  assert.match(shell, /if \(mode === "sessions"\)/)
  assert.match(shell, /<UniversalWorkspace profiles=\{profiles\}/)
  const ordinaryMain = shell.match(/<main className=\{`tdw-main\$\{mobileDetailOpen \? " mobile-open" : ""\}`\}>[\s\S]*?<\/main>/)
  assert.ok(ordinaryMain)
  assert.doesNotMatch(ordinaryMain[0], /UniversalWorkspace/)
})

test("shared conversation keeps bounded paging, streaming autoscroll, memoized rows and mobile-friendly keyboard behavior", () => {
  const source = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")

  assert.match(source, /const MessageBubble = memo/)
  assert.match(source, /NEAR_BOTTOM_PX = 96/)
  assert.match(source, /previousHeight/)
  assert.match(source, /previousTop/)
  assert.match(source, /messages, loading, ready, waiting, sending/)
  assert.match(source, /hasTouchFirstPointer/)
  assert.match(source, /event\.ctrlKey/)
  assert.match(source, /event\.metaKey/)
  assert.match(source, /event\.shiftKey/)
  assert.match(source, /COMPOSER_MAX_HEIGHT_PX = 180/)
})
