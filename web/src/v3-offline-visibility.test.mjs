import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const workspace = read("./components/conversation-workspace.tsx")
const overrides = read("./conversation-control-plane-overrides.css")
const navigation = read("./taskdesk-workspace-navigation.css")
const attention = read("./components/work-thread-attention.tsx")
const manifest = JSON.parse(read("../public/manifest.webmanifest"))

test("a phone hides every other offline signal, so the banner has to exist", () => {
  // The machine-health pill, the Machines section and the harness list are all display:none below
  // 780px, which left a disconnected machine invisible until a message failed to send.
  assert.match(navigation, /\.tdw-machine-section, \.tdw-harness-section, \.tdw-filter-section, \.tdw-workspace-heading \{ display: none !important; \}/)
  assert.match(workspace, /const offlineRuntimes = loaded \? runtimes\.filter\(\(runtime\) => runtime\.state === "offline"\) : \[\]/)
  assert.match(workspace, /hr-offline-banner/)
  assert.match(overrides, /\.hr-offline-banner \{/)
})

test("the offline banner names the machine, its error and the way out", () => {
  assert.match(workspace, /is offline`/)
  assert.match(workspace, /offlineRuntimes\[0\]\.error \|\| "Its conversations cannot continue until it reconnects\."/)
  assert.match(workspace, /onClick=\{onManageMachines\}/)
  assert.match(workspace, /role="status"/)
})

test("the banner cannot appear before the first discovery has finished", () => {
  // A machine that has not been probed yet is not an offline machine.
  assert.match(workspace, /loaded \? runtimes\.filter/)
})

test("the attention surface is announced and its options report their state", () => {
  assert.match(attention, /aria-live="polite"/)
  assert.match(attention, /aria-pressed=\{selected\.includes\(option\.label\)\}/)
  assert.match(attention, /aria-label=\{`Custom answer for/)
})

test("the installed app no longer describes itself as an opencode remote", () => {
  assert.doesNotMatch(manifest.description, /opencode coding agent sessions/)
  assert.match(manifest.description, /Any coding agent/)
})

test("the conversation search field is named", () => {
  assert.match(workspace, /aria-label="Search conversations"/)
})
