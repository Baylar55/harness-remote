import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const workspace = read("./components/standalone-universal-workspace.tsx")
const home = read("./components/native-session-home.tsx")
const attention = read("./components/work-thread-attention.tsx")
const workbench = read("./session-first-workbench.css")
const manifest = JSON.parse(read("../public/manifest.webmanifest"))

test("an offline machine remains visible in the Session-first workspace", () => {
  assert.match(workspace, /const offlineCount = runtimes\.filter\(\(runtime\) => runtime\.state === "offline"\)\.length/)
  assert.match(workspace, /onlineCount === 0 \? \(/)
  assert.match(workspace, /t\("sf\.machinesUnavailable"\)/)
  assert.match(workspace, /t\("sf\.couldNotConnect"\)/)
  assert.match(workspace, /t\("sf\.offlineBody", \{ count: offlineCount \}\)/)
  assert.match(workspace, /onClick=\{onManageMachines\}/)
})

test("the Session rail preserves each machine state and its real error", () => {
  assert.match(home, /hr-native-machine-group \$\{state\}/)
  assert.match(home, /error \|\| t\("sf\.machineOffline"\)/)
  assert.match(home, /t\("sf\.machineUnavailableSaved"\)/)
  assert.match(workbench, /\.hr-native-machine-group\.offline \.hr-native-machine-empty/)
})

test("a machine is not called offline before discovery resolves", () => {
  assert.match(workspace, /state: "loading"/)
  assert.match(workspace, /loadingCount > 0/)
  assert.match(workspace, /t\("sf\.connectingMachines"\)/)
})

test("the attention surface is announced and its options report their state", () => {
  assert.match(attention, /aria-live="polite"/)
  assert.match(attention, /aria-pressed=\{selected\.includes\(option\.label\)\}/)
  assert.match(attention, /aria-label=\{`Custom answer for/)
})

test("the installed app describes the multi-harness product", () => {
  assert.doesNotMatch(manifest.description, /opencode coding agent sessions/i)
  assert.match(manifest.description, /Any coding agent/i)
})

test("native Session search and attention filtering stay reachable on phone", () => {
  assert.match(home, /type="search"/)
  assert.match(home, /aria-label=\{t\("sf\.searchSessionsLabel"\)\}/)
  assert.match(home, /filter === "attention"/)
  assert.match(home, /t\("sf\.filterAttention"\)/)
  assert.match(workspace, /hr-mobile-nav-badge/)
  assert.match(workspace, /onAttentionCountChange=\{setAttentionCount\}/)
})

test("offline guards do not resurrect the retired Conversation interface", () => {
  assert.equal(existsSync(new URL("./components/conversation-workspace.tsx", import.meta.url)), false)
  assert.equal(existsSync(new URL("./components/conversation-detail.tsx", import.meta.url)), false)
  assert.doesNotMatch(workspace, /Conversation filters/)
})
