import assert from "node:assert/strict"
import { handoffNativeSession } from "./native-session-handoff.ts"

class MemoryStorage {
  constructor(entries = []) { this.map = new Map(entries) }
  get length() { return this.map.size }
  key(index) { return [...this.map.keys()][index] ?? null }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(String(key), String(value)) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear() }
}

const source = {
  key: "machine-1:pi:source-1",
  ref: { machineID: "machine-1", agentID: "pi", sessionID: "source-1", directory: "/repo" },
  machineID: "machine-1",
  agentID: "pi",
  agentLabel: "PI",
  backend: "pi",
  transport: "acp",
  sessionID: "source-1",
  directory: "/repo",
  title: "Source",
  config: {
    backend: "pi",
    agentId: "pi",
    host: "127.0.0.1",
    port: 4999,
    username: "",
    password: ""
  },
  external: false,
  modelsSupported: true,
  commandsSupported: false,
  renameSupported: false,
  deleteSupported: false,
  requiresExplicitClaim: false,
  canStop: true
}

const storageKey = "harness-remote.native-session-handoff.v1:machine-1:pi:source-1"
const oldCreatedAt = Date.now() - (24 * 60 * 60 * 1000)
const model = { providerID: "omp", modelID: "omp-fast" }
const oldPending = {
  clientRequestId: "handoff-old-request",
  targetAgentID: "omp",
  title: "Source",
  model,
  createdAt: oldCreatedAt
}

const originalStorage = globalThis.localStorage
const originalFetch = globalThis.fetch
try {
  const storage = new MemoryStorage([[storageKey, JSON.stringify(oldPending)]])
  globalThis.localStorage = storage

  let acceptedBody
  globalThis.fetch = async (_url, options) => {
    acceptedBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      status: "accepted",
      result: {
        target: { machineID: "machine-1", agentID: "omp", sessionID: "target-1", directory: "/repo" },
        link: {
          type: "handoff",
          source: source.ref,
          target: { machineID: "machine-1", agentID: "omp", sessionID: "target-1", directory: "/repo" },
          createdAt: new Date().toISOString()
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }

  const accepted = await handoffNativeSession(source, "omp", "Source", model)
  assert.equal(accepted.status, "accepted")
  assert.equal(acceptedBody.clientRequestId, oldPending.clientRequestId, "resource creation must reuse its idempotency key even after 24 hours")
  assert.equal(storage.getItem(storageKey), null, "accepted resource creation may clear the pending key")

  storage.setItem(storageKey, JSON.stringify(oldPending))
  globalThis.fetch = async () => { throw new Error("lost response") }
  await assert.rejects(
    () => handoffNativeSession(source, "omp", "Source", model),
    /delivery status is unknown/
  )
  assert.equal(
    JSON.parse(storage.getItem(storageKey)).clientRequestId,
    oldPending.clientRequestId,
    "ambiguous resource creation must retain the original idempotency key without TTL expiry"
  )

  storage.setItem(storageKey, JSON.stringify({ ...oldPending, clientRequestId: "definite-rejection" }))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "model rejected" }), {
    status: 409,
    headers: { "Content-Type": "application/json" }
  })
  await assert.rejects(() => handoffNativeSession(source, "omp", "Source", model), /model rejected/)
  assert.equal(storage.getItem(storageKey), null, "a definite 4xx may release the resource-creation key")

  let retryBody
  globalThis.fetch = async (_url, options) => {
    retryBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      status: "accepted",
      result: {
        target: { machineID: "machine-1", agentID: "omp", sessionID: "target-2", directory: "/repo" }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  await handoffNativeSession(source, "omp", "Source", model)
  assert.notEqual(retryBody.clientRequestId, "definite-rejection", "after a proven rejection a new resource-creation attempt may use a new id")
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalStorage
}

console.log("native Session handoff recovery tests passed")
