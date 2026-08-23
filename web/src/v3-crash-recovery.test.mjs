import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const keys = read("./storageKeys.ts")
const boundary = read("./ErrorBoundary.tsx")
const main = read("./main.tsx")
const machines = read("./workspaceMachines.ts")

test("crash recovery clears the configuration the 3.0 shell actually boots from", () => {
  // main.tsx boots from loadWorkspaceMachines, not from the 2.x server profiles. A reset list that
  // only held the legacy keys left a poisoned machine entry to crash the app on every launch, with
  // the recovery button doing nothing — the Android black screen the boundary exists to prevent.
  assert.match(main, /loadWorkspaceMachines/)
  assert.match(machines, /WORKSPACE_MACHINES_STORAGE_KEY = "harness-remote\.workspace\.machines\.v1"/)
  assert.match(keys, /import \{ WORKSPACE_MACHINES_STORAGE_KEY \} from "\.\/workspaceMachines"/)
  assert.match(keys, /^\s*WORKSPACE_MACHINES_STORAGE_KEY,$/m)
})

test("the v3 layout keys read at mount are resettable too", () => {
  for (const key of [
    "harness-remote.v3.workspace-collapsed",
    "harness-remote.v3.workspace-sections-collapsed",
    "harness-remote.v3.conversation-pane-width",
    "harness-remote.v3.conversation-drawer-open"
  ]) {
    assert.ok(keys.includes(`"${key}"`), `${key} must be clearable by crash recovery`)
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
