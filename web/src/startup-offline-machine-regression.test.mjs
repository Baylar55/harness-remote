import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8")
const bridge = readFileSync(new URL("./desktopBridge.ts", import.meta.url), "utf8")

// The desktop-owned runtime is polled every few seconds. That poll must not manufacture a new
// semantic runtime state on every pass: NativeSessionsWorkspace discovers all configured machines
// concurrently, and a new machines array cancels the in-flight pass. A slow/offline saved endpoint
// would otherwise be restarted forever before it can settle offline, leaving startup on
// "Connecting to your machines…" even though the embedded local machine is already healthy.
assert.match(main, /setTimeout\(refresh, state\?\.status === "starting" \? 400 : 4_000\)/)
assert.match(bridge, /sameLocalRuntimeState\(localRuntime, next\)/)
assert.match(bridge, /if \(sameLocalRuntimeState\(localRuntime, next\)\) return localRuntime!/)

console.log("desktop offline-machine startup regression guard passed")