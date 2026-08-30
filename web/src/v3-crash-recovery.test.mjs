import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const keys = read("./storageKeys.ts")
const boundary = read("./ErrorBoundary.tsx")
const main = read("./main.tsx")
const machines = read("./workspaceMachines.ts")
const workspace = read("./components/standalone-universal-workspace.tsx")

test("crash recovery clears the configuration the Session-first shell actually boots from", () => {
  assert.match(main, /loadWorkspaceMachines/)
  assert.match(machines, /WORKSPACE_MACHINES_STORAGE_KEY = "harness-remote\.workspace\.machines\.v1"/)
  assert.match(keys, /import \{ WORKSPACE_MACHINES_STORAGE_KEY \} from "\.\/workspaceMachines"/)
  assert.match(keys, /^\s*WORKSPACE_MACHINES_STORAGE_KEY,$/m)
})

test("the current Session rail layout key is resettable", () => {
  assert.match(workspace, /RAIL_WIDTH_STORAGE_KEY = "harness-remote\.sessionRailWidth\.v1"/)
  assert.ok(keys.includes('"harness-remote.sessionRailWidth.v1"'))
})

test("retired Conversation-first layout keys are no longer part of the current recovery contract", () => {
  for (const key of [
    "harness-remote.v3.workspace-collapsed",
    "harness-remote.v3.workspace-sections-collapsed",
    "harness-remote.v3.conversation-pane-width",
    "harness-remote.v3.conversation-drawer-open"
  ]) {
    assert.ok(!keys.includes(`"${key}"`), `${key} belongs only to the retired Conversation UI`)
  }
})

test("appearance is still preserved and the copy says what is lost", () => {
  assert.ok(!keys.includes("opencode.remote.language"), "language must survive a reset")
  assert.ok(!keys.includes("opencode.remote.theme"), "theme must survive a reset")
  assert.match(boundary, /including your configured machines/)
  assert.match(boundary, /Reset app configuration/)
})

test("one unremovable key cannot abort the whole recovery", () => {
  assert.match(boundary, /try \{\s*localStorage\.removeItem\(key\)\s*\} catch \{/)
})
