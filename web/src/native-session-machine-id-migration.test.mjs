import assert from "node:assert/strict"
import { migrateNativeSessionMachineStorage } from "./native-session-machine-id-migration.ts"

class MemoryStorage {
  constructor(entries = []) { this.map = new Map(entries) }
  get length() { return this.map.size }
  key(index) { return [...this.map.keys()][index] ?? null }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(String(key), String(value)) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear() }
}

const oldID = "workspace-profile-123"
const canonicalID = "daemon-machine-abc"
const old = encodeURIComponent(oldID)
const canonical = encodeURIComponent(canonicalID)

const prefixes = [
  "harness-remote.native-session-prompt.v1:",
  "harness-remote.native-session-command.v1:",
  "harness-remote.native-session-handoff.v1:",
  "harness-remote.native-session-handoff-context.v1:",
  "harness-remote.native-session-route-continue.v1:"
]

const entries = prefixes.map((prefix, index) => [
  `${prefix}${old}:pi:session-${index}`,
  JSON.stringify({ clientRequestId: `request-${index}`, createdAt: 1234 + index })
])
entries.push([
  `harness-remote.taskdesk.draft.native-session-v3:${old}:pi:session-draft`,
  "unsent draft"
])

const storage = new MemoryStorage(entries)
migrateNativeSessionMachineStorage(oldID, canonicalID, storage)

for (const [legacyKey, value] of entries) {
  assert.equal(storage.getItem(legacyKey), null, `legacy key was not removed: ${legacyKey}`)
  const migratedKey = legacyKey.replace(old, canonical)
  assert.equal(storage.getItem(migratedKey), value, `value was not preserved at canonical key: ${migratedKey}`)
}

const conflictLegacy = `harness-remote.native-session-prompt.v1:${old}:pi:conflict`
const conflictCanonical = `harness-remote.native-session-prompt.v1:${canonical}:pi:conflict`
storage.setItem(conflictLegacy, "legacy-uncertain-request")
storage.setItem(conflictCanonical, "canonical-request")
migrateNativeSessionMachineStorage(oldID, canonicalID, storage)
assert.equal(storage.getItem(conflictLegacy), "legacy-uncertain-request", "migration must not destroy conflicting legacy recovery state")
assert.equal(storage.getItem(conflictCanonical), "canonical-request", "migration must not overwrite canonical recovery state")

const sameStorage = new MemoryStorage([["keep", "value"]])
migrateNativeSessionMachineStorage(canonicalID, canonicalID, sameStorage)
assert.equal(sameStorage.getItem("keep"), "value")

console.log("native Session canonical machine-id storage migration tests passed")
