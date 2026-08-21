import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("TaskDesk desktop live events follow the selected daemon agent", () => {
  const contract = readFileSync(new URL("../electron/ipc-contract.ts", import.meta.url), "utf8")
  const bridge = readFileSync(new URL("./desktopBridge.ts", import.meta.url), "utf8")
  const transport = readFileSync(new URL("../electron/event-transport.ts", import.meta.url), "utf8")
  const liveEvents = readFileSync(new URL("./taskdesk-live-events.ts", import.meta.url), "utf8")

  assert.match(contract, /backend\?: BackendKind/)
  assert.match(contract, /agentId\?: string/)
  assert.match(liveEvents, /backend: config\.backend/)
  assert.match(liveEvents, /agentId: config\.agentId/)
  assert.match(bridge, /backend: options\.backend/)
  assert.match(bridge, /agentId: options\.agentId/)
  assert.match(transport, /const targetProfile = eventProfile\(profile, subscription\.options\)/)
  assert.match(transport, /routingHeaders\(targetProfile, \{ preflight: false \}\)/)
  assert.match(transport, /streamURL\(targetProfile, subscription\.options\)/)
})

test("desktop event routing validates the renderer supplied route", () => {
  const transport = readFileSync(new URL("../electron/event-transport.ts", import.meta.url), "utf8")
  assert.match(transport, /EVENT_BACKENDS/)
  assert.match(transport, /Event subscription backend is invalid/)
  assert.match(transport, /\^\[A-Za-z0-9\._-\]\+\$/)
  assert.match(transport, /Event subscription agent is invalid/)
})

test("TaskDesk Session workspace uses live events as the primary refresh path", () => {
  const workspace = readFileSync(new URL("./components/universal-workspace.tsx", import.meta.url), "utf8")

  assert.match(workspace, /const REFRESH_INTERVAL_MS = 60_000/)
  assert.match(workspace, /const DETAIL_REFRESH_INTERVAL_MS = 30_000/)
  assert.match(workspace, /startTaskDeskSessionLiveRefresh\(\{/)
  assert.match(workspace, /onMessage:[\s\S]*?refreshMessageTail\(item\)/)
  assert.match(workspace, /onIndex:[\s\S]*?refreshAll\(true\)/)
  assert.match(workspace, /onDetail:[\s\S]*?loadDetail\(item, true\)/)
  assert.match(workspace, /if \(!pageIsVisible\(\)\) return/)
  assert.match(workspace, /<TaskDeskMessageContent message=\{message\} \/>/)
})
