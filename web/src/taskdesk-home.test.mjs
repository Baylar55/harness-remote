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

test("TaskDesk normalizes backend lifecycle states for the Tasks view", () => {
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

test("TaskDesk derives stable task row labels without flattening Tasks into Sessions", () => {
  const value = task()
  assert.equal(taskTitle(value), "Fix the authentication regression")
  assert.equal(modelLabel(value), "gpt-test · high")
  assert.equal(agentLabel([
    { id: "codex", label: "Codex CLI", backend: "codex", transport: "acp", managed: false, state: "available", capabilities: {} }
  ], value.agentId), "Codex CLI")
  assert.equal(agentLabel([], "pi"), "pi")
})

test("TaskDesk sorts Tasks by durable task activity rather than session order", () => {
  const older = task({ id: "older", updatedAt: "2026-08-18T09:00:00.000Z" })
  const newer = task({ id: "newer", updatedAt: "2026-08-18T12:00:00.000Z" })
  assert.deepEqual(sortTasksByActivity([older, newer]).map((item) => item.id), ["newer", "older"])
})

test("TaskDesk machine configuration remains independent from Classic profiles and activates the unified shell", () => {
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8")
  const machineStorage = readFileSync(new URL("./workspaceMachines.ts", import.meta.url), "utf8")
  const standalone = readFileSync(new URL("./components/standalone-universal-workspace.tsx", import.meta.url), "utf8")
  const taskDeskBoundary = main.match(/function TaskDeskBoundary\(\) \{[\s\S]*?\n\}\n\nasync function renderApp/)

  assert.ok(taskDeskBoundary, "TaskDesk boundary should remain explicit")
  assert.match(taskDeskBoundary[0], /loadWorkspaceMachines/)
  assert.doesNotMatch(taskDeskBoundary[0], /loadServerProfiles/)
  assert.match(machineStorage, /harness-remote\.workspace\.machines\.v1/)
  assert.match(standalone, /import \{ TaskDeskV3Unified \} from "\.\/taskdesk-v3-unified"/)
  assert.match(standalone, /<TaskDeskV3Unified/)
  assert.doesNotMatch(standalone, /<TaskDeskV3\n/)
  assert.match(standalone, /\+ Add machine/)
})

test("TaskDesk v3 exposes Tasks as a separate durable product surface", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")

  assert.match(source, /type TaskDeskView = "overview" \| "tasks" \| "sessions"/)
  assert.match(source, />Tasks</)
  assert.match(source, />Sessions</)
  assert.match(source, /Task → Run → Session/)
  assert.match(source, /Run history/)
  assert.match(source, /taskRunHistory\(selected\.task\)/)
  assert.match(source, /<UniversalWorkspace/)
})

test("TaskDesk v3 New Task uses real machine task APIs and explicit workspace choice", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")

  assert.match(source, /taskClient\.createTask/)
  assert.match(source, /taskClient\.prepareWorktree/)
  assert.match(source, /taskClient\.launch/)
  assert.match(source, /Use an isolated Git worktree/)
  assert.match(source, /Project directory/)
})

test("TaskDesk v3 Task detail uses the native Run session and lifecycle APIs", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")
  const client = readFileSync(new URL("./taskClient.ts", import.meta.url), "utf8")

  assert.match(source, /api\.loadMessages\(config, sessionID, directory\)/)
  assert.match(source, /api\.loadDiff\(config, sessionID, directory\)/)
  assert.match(source, /taskClient\.inspectResult/)
  assert.match(source, /taskClient\.finish/)
  assert.match(source, /taskClient\.cleanupWorkspace/)
  assert.match(source, /taskClient\.continueTask/)
  assert.match(client, /\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/continue/)
  assert.match(client, /\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/finish/)
  assert.match(client, /\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/result/)
})

test("Task clicks explicitly open a closable review detail instead of silently changing selection", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-v3-unified.css", import.meta.url), "utf8")

  assert.match(source, /const \[detailOpen, setDetailOpen\] = useState\(false\)/)
  assert.match(source, /function openTask\(record: TaskRecord/)
  assert.match(source, /setDetailOpen\(true\)/)
  assert.match(source, /onClick=\{\(\) => openTask\(record\)\}/)
  assert.match(source, /aria-label="Close Task detail"/)
  assert.match(source, /setDetailOpen\(false\)/)
  assert.match(css, /\.td3-tasks-layout-unified\.detail-open/)
  assert.match(css, /@keyframes td3-detail-enter/)
})

test("Sessions stays inside the persistent TaskDesk product shell without the old floating return button", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("./taskdesk-v3-unified.css", import.meta.url), "utf8")

  assert.match(source, /<div className="td3-shell td3-shell-unified">[\s\S]*?\{nav\}[\s\S]*?\{topbar\}/)
  assert.match(source, /view === "sessions" \? <main className="td3-sessions-embedded"><UniversalWorkspace/)
  assert.match(source, /const sessionProfiles = machineScope === "all" \? machines : machines\.filter/)
  assert.doesNotMatch(source, /td3-session-mode/)
  assert.doesNotMatch(source, /td3-return-button/)
  assert.match(css, /\.td3-sessions-embedded \.uw-brand,[\s\S]*?\.td3-sessions-embedded \.uw-top-actions[\s\S]*?display: none/)
  assert.match(css, /\.td3-sessions-embedded \.uw-shell/)
})

test("TaskDesk distinguishes completed Runs awaiting review from explicitly finished Tasks", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")
  const finishServer = readFileSync(new URL("../../bridge/src/task-finish-server.js", import.meta.url), "utf8")

  assert.match(source, /if \(task\.finishedAt\) return "finished"/)
  assert.match(source, /if \(status === "completed"\) return "review"/)
  assert.match(source, /Ready for review/)
  assert.match(source, />Finish Task</)
  assert.match(source, />Cleanup Workspace</)
  assert.doesNotMatch(source, /Review \/ Finish/)
  assert.match(finishServer, /taskStore\.markFinished/)
  assert.doesNotMatch(finishServer, /worktreeManager\.cleanup/)
  assert.doesNotMatch(finishServer, /taskStore\.clearWorkspace/)
})

test("TaskDesk v3 protects Task detail from stale asynchronous responses", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")

  assert.match(source, /const detailGeneration = useRef\(0\)/)
  assert.match(source, /const generation = \+\+detailGeneration\.current/)
  assert.match(source, /if \(generation !== detailGeneration\.current\) return/)
  assert.match(source, /ownerKey: record\.key/)
  assert.match(source, /detail\.ownerKey === selected\.key/)
})

test("TaskDesk v3 aggregates native questions and permissions into Needs You", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")

  assert.match(source, /api\.loadQuestions\(config\)/)
  assert.match(source, /api\.loadPermissions\(config\)/)
  assert.match(source, /api\.replyPermission/)
  assert.match(source, /api\.replyQuestion/)
  assert.match(source, />Needs You</)
})

test("Universal workspace cannot starve initial loading with overlapping polls", () => {
  const source = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /const AGENT_SESSION_LOAD_TIMEOUT_MS = 12_000/)
  assert.match(source, /const refreshInFlight = useRef\(false\)/)
  assert.match(source, /if \(refreshInFlight\.current\) return/)
  assert.match(source, /await withTimeout\(Promise\.all\(\[/)
  assert.match(source, /refreshInFlight\.current = false/)
})

test("Universal workspace counts and projects follow the selected machine scope", () => {
  const source = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(source, /const machineScopedSessions = useMemo/)
  assert.match(source, /for \(const item of machineScopedSessions\)/)
  assert.match(source, /all: scopedSessions\.length/)
  assert.doesNotMatch(source, /all: sessions\.length/)
  assert.match(source, /function selectMachine\(machine: MachineSource\)[\s\S]*?setProjectFilter\("all"\)/)
  assert.match(source, /currentItem\?\.machineKey === machine\.key/)
})

test("Universal workspace resolves and can change the model of the selected session", () => {
  const source = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(source, /api\.listModels\(selected\.config, selected\.session\.directory, selected\.session\.id\)/)
  assert.match(source, /models\.find\(\(model\) => model\.isDefault\)/)
  assert.match(source, /className="uw-context-model-select"/)
  assert.match(source, /setSessionModelKey\(event\.target\.value\)/)
  assert.match(source, /const model = selectedSessionModel/)
  assert.match(source, /api\.sendPrompt\(selected\.config, selected\.session\.id, text, selected\.session\.directory, model\)/)
})

test("Universal workspace gives supported harness replies their own local visual identity", () => {
  const source = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")
  const readableFixes = readFileSync(new URL("./universal-workspace-readable-fixes.css", import.meta.url), "utf8")

  assert.match(source, /const HARNESS_ICON_FILES/)
  for (const backend of ["codex", "claude", "opencode", "omp", "pi"]) {
    assert.match(source, new RegExp(`${backend}:`))
    assert.match(source, new RegExp(`${backend}\\.svg`))
  }
  assert.match(source, /import\.meta\.env\.BASE_URL.*harness-icons/)
  assert.doesNotMatch(source, /https:\/\/(?:openai|claude|opencode|omp|pi)\./)
  assert.match(source, /function HarnessAvatar/)
  assert.match(source, /agentBackend=\{selected\.agent\.backend\}/)
  assert.match(readableFixes, /\.uw-avatar-agent img/)
  assert.match(readableFixes, /\.uw-composer-footer > \.uw-composer-directory[\s\S]*?font-size: 13px/)
  assert.match(readableFixes, /\.uw-context-strip b,[\s\S]*?\.uw-context-model-select[\s\S]*?font-size: 11\.5px/)
})

test("Universal workspace never renders stale detail for a newly selected session", () => {
  const source = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(source, /const \[detailSessionKey, setDetailSessionKey\] = useState<string \| null>\(null\)/)
  assert.match(source, /const selectedKeyRef = useRef<string \| null>\(null\)/)
  assert.match(source, /const detailReady = Boolean\(selected && detailSessionKey === selected\.key\)/)
  assert.match(source, /if \(selectedKeyRef\.current !== item\.key\) return/)
  assert.match(source, /setDetailSessionKey\(item\.key\)/)
  assert.match(source, /detailLoading \|\| !detailReady/)
  assert.match(source, /Loading session…/)
})
