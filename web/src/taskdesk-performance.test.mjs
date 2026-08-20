import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("TaskDesk pauses hidden work and avoids duplicate Tasks and Sessions polling", () => {
  const taskDesk = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")
  const workspace = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(taskDesk, /const REFRESH_MS = 10_000/)
  assert.match(taskDesk, /const DETAIL_REFRESH_MS = 5_000/)
  assert.match(taskDesk, /if \(view === "sessions" \|\| view === "classic"\) return/)
  assert.match(taskDesk, /if \(view !== "tasks" \|\| !selected \|\| !detailOpen\)/)
  assert.match(taskDesk, /if \(pageIsVisible\(\)\) void refresh\(\)/)

  assert.match(workspace, /const REFRESH_INTERVAL_MS = 10_000/)
  assert.match(workspace, /const DETAIL_REFRESH_INTERVAL_MS = 5_000/)
  assert.match(workspace, /const detailInFlight = useRef\(false\)/)
  assert.match(workspace, /if \(detailInFlight\.current && silent\) return/)
  assert.match(workspace, /if \(pageIsVisible\(\)\) void refreshAll\(true\)/)
})

test("Sessions list never fans out transcript reads for card previews", () => {
  const workspace = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(workspace, /loadLatestMessage/)
  assert.doesNotMatch(workspace, /topSessions/)
  assert.doesNotMatch(workspace, /setPreviews/)
  assert.match(workspace, /session\.summary\?\.files/)
})

test("Task detail fetches only data required by the active review tab", () => {
  const source = readFileSync(new URL("./components/taskdesk-v3-unified.tsx", import.meta.url), "utf8")

  assert.match(source, /const needsMessages = tab === "review" \|\| tab === "conversation"/)
  assert.match(source, /const needsDiff = tab === "review" \|\| tab === "diff"/)
  assert.match(source, /const needsTodos = tab === "review"/)
  assert.match(source, /const needsVcs = tab === "review"/)
  assert.match(source, /loadDetail\(selected, detailTab, false\)/)
  assert.match(source, /loadDetail\(selected, detailTab, true\)/)
})

test("ACP bridge has lightweight session indexing, cursor paging and cache diagnostics", () => {
  const source = readFileSync(new URL("../../bridge/src/server.js", import.meta.url), "utf8")
  const service = readFileSync(new URL("../../bridge/src/acp-service.js", import.meta.url), "utf8")

  assert.match(source, /const listVisibleSessionMetadata = async/)
  assert.match(source, /url\.pathname === "\/experimental\/session"[\s\S]*?listVisibleSessionMetadata/)
  assert.match(source, /url\.pathname === "\/session\/status"[\s\S]*?listVisibleSessionMetadata/)
  assert.match(source, /const MAX_MESSAGE_PAGE = 500/)
  assert.match(source, /service\.messagePage\(sessionID/)
  assert.match(source, /url\.searchParams\.get\("before"\)/)
  assert.match(source, /X-Next-Cursor/)
  assert.match(source, /X-Has-More/)
  assert.match(source, /url\.pathname === "\/v1\/diagnostics"/)
  assert.match(source, /service: service\.diagnostics\(\)/)
  assert.match(service, /#messages = new TranscriptCache/)
  assert.match(service, /async messagePage\(sessionID/)
})

test("TaskDesk responsive layout uses focused mobile pages and at most two persistent Session panes", () => {
  const polish = readFileSync(new URL("./v3-polish.css", import.meta.url), "utf8")
  const mobileNavigation = readFileSync(new URL("./taskdesk-mobile-navigation.ts", import.meta.url), "utf8")

  assert.match(polish, /article:has\(> \.td3-agent-badge\)[\s\S]*?grid-template-columns: minmax\(152px, 178px\) minmax\(0, 1fr\)/)
  assert.match(polish, /\.td3-sessions-embedded \.uw-layout[\s\S]*?grid-template-columns: minmax\(300px, 360px\) minmax\(0, 1fr\)/)
  assert.match(polish, /\.td3-sessions-embedded \.uw-nav[\s\S]*?display: none !important/)
  assert.match(polish, /\.td3-sessions-embedded \.uw-inspector[\s\S]*?position: absolute/)
  assert.match(polish, /\.td3-tasks-layout-unified\.detail-open \.td3-task-list-pane[\s\S]*?display: none/)
  assert.match(polish, /\.td3-workspace:has\(\.td3-tasks-layout-unified\.detail-open\) > \.td3-topbar[\s\S]*?display: none/)
  assert.match(polish, /\.td3-sessions-embedded \.uw-main[\s\S]*?display: none/)
  assert.match(polish, /\.td3-sessions-embedded\.td3-mobile-session-detail \.uw-session-column[\s\S]*?display: none/)
  assert.match(polish, /\.td3-sessions-embedded\.td3-mobile-session-detail \.uw-main[\s\S]*?display: flex/)

  assert.match(mobileNavigation, /SESSION_DETAIL_CLASS = "td3-mobile-session-detail"/)
  assert.match(mobileNavigation, /target\.closest<HTMLButtonElement>\("\.td3-sessions-embedded \.uw-session-card"\)/)
  assert.match(mobileNavigation, /button\.textContent = "‹ Sessions"/)
  assert.match(mobileNavigation, /showSessionList\(\)/)
})

test("TaskDesk mobile keeps create actions reachable and a manual Session choice stable", () => {
  const mobileNavigation = readFileSync(new URL("./taskdesk-mobile-navigation.ts", import.meta.url), "utf8")

  assert.match(mobileNavigation, /button\.textContent = "\+ New Task"/)
  assert.match(mobileNavigation, /button\.textContent = "\+ New Session"/)
  assert.match(mobileNavigation, /find\(\(candidate\) => buttonLabel\(candidate\) === "New Task"\)/)
  assert.match(mobileNavigation, /root\.querySelector<HTMLButtonElement>\("\.uw-new-button"\)\?\.click\(\)/)
  assert.match(mobileNavigation, /let manuallySelectedSession: HTMLButtonElement \| null = null/)
  assert.match(mobileNavigation, /manuallySelectedSession = sessionCard/)
  assert.match(mobileNavigation, /restoreManualSelection/)
  assert.match(mobileNavigation, /manuallySelectedSession\.click\(\)/)
  assert.match(mobileNavigation, /attributeFilter: \["class"\]/)
})
