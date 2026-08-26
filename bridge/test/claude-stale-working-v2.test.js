import assert from "node:assert/strict"
import test from "node:test"
import { corroborateClaudeSessionStatus } from "../src/server.js"

test("Claude stale busy without any in-flight prompt is idle", () => {
  assert.deepEqual(
    corroborateClaudeSessionStatus({ type: "busy" }, "old-session", [], 0, 1_800_000_000_000),
    { type: "idle" }
  )
})
