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

test("ACP bridge has lightweight session indexing, bounded message responses and diagnostics", () => {
  const source = readFileSync(new URL("../../bridge/src/server.js", import.meta.url), "utf8")

  assert.match(source, /const listVisibleSessionMetadata = async/)
  assert.match(source, /url\.pathname === "\/experimental\/session"[\s\S]*?listVisibleSessionMetadata/)
  assert.match(source, /url\.pathname === "\/session\/status"[\s\S]*?listVisibleSessionMetadata/)
  assert.match(source, /const MAX_MESSAGE_PAGE = 500/)
  assert.match(source, /messages\.slice\(-limit\)/)
  assert.match(source, /url\.pathname === "\/v1\/diagnostics"/)
})
