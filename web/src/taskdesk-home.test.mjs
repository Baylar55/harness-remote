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

test("legacy task status normalization remains compatible with persisted records", () => {
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

test("persisted task records retain stable labels", () => {
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

test("TaskDesk machine configuration remains independent from Classic profiles and activates Tasks", () => {
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
})

test("primary product surface is Project -> Task -> Conversation while Runs and Sessions remain technical", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const detail = readFileSync(new URL("./components/work-thread-detail.tsx", import.meta.url), "utf8")
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")

  assert.match(shell, /<span className="tdw-workspace-label">Projects<\/span>/)
  assert.match(shell, /<h2>Tasks<\/h2>/)
  assert.match(shell, />New Task</)
  assert.match(shell, /<WorkThreadDetail/)
  assert.match(shell, /key=\{selected\.key\}/)
  assert.doesNotMatch(shell, /function latestSessionID/)
  assert.doesNotMatch(shell, /focusSessionRequest/)
  assert.doesNotMatch(shell, />Runs</)
  assert.match(detail, />Conversation</)
  assert.match(detail, />Changes</)
  assert.match(detail, />Result</)
  assert.match(detail, />History/)
  assert.match(detail, /<WorkThreadConversation/)
  assert.match(conversation, /<TaskDeskConversation/)
  assert.match(conversation, /buildWorkThreadTimeline/)
})

test("Workspace sidebar exposes collapsible machines projects harnesses filters and adaptive sizing", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-workspace-navigation.css", import.meta.url), "utf8")

  assert.match(shell, /selectedMachineID/)
  assert.match(shell, /tdw-machine-section/)
  assert.match(shell, /tdw-project-section/)
  assert.match(shell, /tdw-harness-section/)
  assert.match(shell, /tdw-filter-section/)
  assert.match(shell, /runtime\.snapshot\?\.agents/)
  assert.match(shell, /Task filters/)
  assert.match(shell, /workspaceCollapsed/)
  assert.match(shell, /WORKSPACE_SECTIONS_COLLAPSED_KEY/)
  assert.match(shell, /toggleWorkspaceSection\("machines"\)/)
  assert.match(shell, /toggleWorkspaceSection\("projects"\)/)
  assert.match(shell, /toggleWorkspaceSection\("harnesses"\)/)
  assert.match(shell, /toggleWorkspaceSection\("filters"\)/)
  assert.match(shell, /aria-expanded=/)
  assert.ok(shell.indexOf("tdw-project-section") < shell.indexOf("tdw-harness-section"), "Projects must precede Harnesses")
  assert.match(shell, /TASK_PANE_WIDTH_KEY/)
  assert.match(shell, /tdw-pane-resizer/)
  assert.match(css, /workspace-collapsed/)
  assert.match(css, /section-collapsed/)
  assert.match(css, /tdw-workspace-section-header/)
  assert.match(css, /--tdw-thread-width/)
  assert.match(css, /cursor: col-resize/)
  assert.doesNotMatch(shell, /All agents quiet/)
  assert.doesNotMatch(shell, /Manage machines/)
})

test("lazy detected harnesses are healthy Ready while started harnesses are Running", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-workspace-navigation.css", import.meta.url), "utf8")

  assert.match(shell, /agent\.state === "available" \|\| agent\.state === "configured"/)
  assert.match(shell, /if \(agent\.state === "available"\) return "Running"/)
  assert.match(shell, /if \(agent\.state === "configured"\) return "Ready"/)
  assert.match(shell, /starts on use/)
  assert.match(css, /tdw-presence-dot\.online, \.tdw-presence-dot\.available, \.tdw-presence-dot\.configured/)
  assert.match(css, /uw-machine-harness > i\.available, \.uw-machine-harness > i\.configured/)
})

test("Task states distinguish agent completion from user completion", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const detail = readFileSync(new URL("./components/work-thread-detail.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-workspace-navigation.css", import.meta.url), "utf8")

  assert.match(shell, /if \(task\.finishedAt\) return "done"/)
  assert.match(shell, /task\.status === "failed"\) return "attention"/)
  assert.match(shell, /task\.status === "cancelled"\) return "stopped"/)
  assert.match(shell, /task\.status === "completed"\) return "ready"/)
  assert.match(detail, /if \(task\.finishedAt\) return "Done"/)
  assert.match(detail, /stateClass\(task\)/)
  assert.match(css, /tdw-thread-status\.done/)
  assert.match(css, /tdw-live-state\.done/)
})

test("New Task starts immediately selected and invalidates stale machine refreshes", () => {
  const source = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")

  assert.match(source, /taskClient\.createTask/)
  assert.match(source, /taskClient\.prepareWorktree/)
  assert.match(source, /label: "Before work began"/)
  assert.match(source, /kind: "baseline"/)
  assert.match(source, /taskClient\.launch/)
  assert.match(source, /refreshGeneration\.current \+= 1/)
  assert.match(source, /setSelectedThreadKey\(`\$\{runtime\.machine\.id\}:\$\{task\.id\}`\)/)
})

test("Task composer continues through product lifecycle and can switch agent/model", () => {
  const source = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const client = readFileSync(new URL("./taskClient.ts", import.meta.url), "utf8")

  assert.match(source, /taskClient\.getWorkThread\(baseConfig, task\.id\)/)
  assert.match(source, /taskClient\.continueTask\(baseConfig, task\.id, \{/)
  assert.match(source, /agentId: targetAgentID/)
  assert.match(source, /providerID: selectedModel\.providerID/)
  assert.match(source, /modelID: selectedModel\.modelID/)
  assert.match(source, /taskClient\.listAgentModels/)
  assert.match(source, /<ModelPicker compact/)
  assert.match(source, /sendInFlightRef\.current/)
  assert.match(source, /if \(!text \|\| sending \|\| working \|\| sendInFlightRef\.current\) return/)
  assert.match(client, /mode\?: "fresh" \| "resume"/)
})

test("model selection is searchable grouped and shared between creation and conversation", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const picker = readFileSync(new URL("./components/model-picker.tsx", import.meta.url), "utf8")
  const pickerCss = readFileSync(new URL("./model-picker.css", import.meta.url), "utf8")
  const shellCss = readFileSync(new URL("./taskdesk-workthreads.css", import.meta.url), "utf8")

  assert.match(shell, /<ModelPicker models=\{models\}/)
  assert.match(conversation, /<ModelPicker compact models=\{models\}/)
  assert.match(picker, /Search model, provider, variant/)
  assert.match(picker, /providerName/)
  assert.match(picker, /tdw-model-variants/)
  assert.match(picker, />Free</)
  assert.match(picker, />Default</)
  assert.match(picker, /inputCost/)
  assert.match(pickerCss, /\.tdw-model-popover/)
  assert.match(pickerCss, /\.tdw-model-provider/)
  assert.match(shellCss, /select option/)
  assert.match(shellCss, /color-scheme: dark/)
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
  assert.match(shared, /ThinkingIndicator/)
  assert.match(shared, /workingLabel/)
  assert.match(shared, /waiting && onStop/)
  assert.match(shared, /className="uw-button uw-button-danger"/)
  assert.match(abort, /service\.abort\(sessionID\)/)
})

test("real native questions and permissions appear inline rather than as permanent navigation", () => {
  const conversation = readFileSync(new URL("./components/work-thread-conversation.tsx", import.meta.url), "utf8")
  const attention = readFileSync(new URL("./components/work-thread-attention.tsx", import.meta.url), "utf8")
  assert.match(conversation, /api\.loadQuestions/)
  assert.match(conversation, /api\.loadPermissions/)
  assert.match(attention, /api\.replyQuestion/)
  assert.match(attention, /api\.replyPermission/)
})

test("Changes Result History checkpoint and Restore are first-class Task surfaces", () => {
  const detail = readFileSync(new URL("./components/work-thread-detail.tsx", import.meta.url), "utf8")
  const checkpoints = readFileSync(new URL("../../bridge/src/work-thread-checkpoints.js", import.meta.url), "utf8")

  assert.match(detail, /taskClient\.inspectWorkspace/)
  assert.match(detail, /api\.loadDiff/)
  assert.match(detail, /taskClient\.finish/)
  assert.match(detail, /Save checkpoint/)
  assert.match(detail, /Restore this version/)
  assert.match(detail, /taskClient\.restoreCheckpoint/)
  assert.match(detail, /<ReactMarkdown remarkPlugins=\{REMARK_PLUGINS\}>\{outcome\}<\/ReactMarkdown>/)
  assert.match(checkpoints, /git.*stash.*create|"stash", "create"/s)
})

test("Native Sessions remain available only as Advanced diagnostics in the normal TaskDesk shell", () => {
  const shell = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
  assert.match(shell, /Advanced: Native Sessions/)
  assert.match(shell, /if \(mode === "sessions"\)/)
  assert.match(shell, /<UniversalWorkspace profiles=\{profiles\}/)
})

test("shared conversation keeps bounded paging streaming autoscroll memoized rows and mobile-friendly keyboard behavior", () => {
  const source = readFileSync(new URL("./components/taskdesk-conversation.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-conversation.css", import.meta.url), "utf8")

  assert.match(source, /const MessageBubble = memo/)
  assert.match(source, /NEAR_BOTTOM_PX = 96/)
  assert.match(source, /previousHeight/)
  assert.match(source, /messages, loading, ready, waiting, sending/)
  assert.match(source, /hasTouchFirstPointer/)
  assert.match(source, /event\.ctrlKey/)
  assert.match(source, /event\.metaKey/)
  assert.match(source, /COMPOSER_MAX_HEIGHT_PX = 180/)
  assert.match(source, /uw-thinking-orb/)
  assert.match(css, /font-size: 15\.5px/)
  assert.match(css, /width: min\(1040px, 100%\)/)
  assert.match(css, /uw-activity-parts/)
  assert.match(css, /overflow-wrap: anywhere/)
})