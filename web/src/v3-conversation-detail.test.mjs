import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const detail = readFileSync(new URL("./components/conversation-detail.tsx", import.meta.url), "utf8")

test("Changes keeps the rendered diff visible across a refresh", () => {
  // `updatedAt` moves on every turn, so this panel reloads constantly while an agent is working.
  // Blanking it each time discarded scroll position and collapsed every expanded file.
  assert.match(detail, /if \(!loaded && refreshing\) return/)
  assert.doesNotMatch(detail, /if \(loading\) return <div className="tdw-detail-loading">/)
  assert.match(detail, /aria-busy=\{refreshing\}/)
})

test("a failed Changes refresh degrades to a warning instead of losing the data", () => {
  assert.match(detail, /if \(error && !loaded\) return <div className="tdw-inline-error"/)
  assert.match(detail, /Showing the last known changes\. Refresh failed:/)
})

test("the detail tabs are a real ARIA tab list with roving focus", () => {
  assert.match(detail, /role="tablist"/)
  assert.match(detail, /role="tab" id="hr-tab-chat" aria-selected=\{tab === "chat"\}/)
  assert.match(detail, /tabIndex=\{tab === "chat" \? 0 : -1\}/)
  assert.match(detail, /role="tabpanel"/)
  assert.match(detail, /event\.key === "ArrowRight"/)
  assert.match(detail, /event\.key === "Home"/)
})

test("renaming a conversation does not depend on a native prompt dialog", () => {
  // window.prompt is rendered outside the app by the Android WebView and suppressed by some
  // embeddings, which left rename simply not working there.
  assert.doesNotMatch(detail.replace(/^\s*\/\/.*$/gm, ""), /window\.prompt/)
  assert.match(detail, /tdw-thread-title-input/)
  assert.match(detail, /aria-label="Conversation title"/)
  assert.match(detail, /if \(event\.key === "Enter"\)/)
  assert.match(detail, /if \(event\.key === "Escape"\)/)
})
