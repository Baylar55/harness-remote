import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createSessionClaimServer } from "../src/session-claim-server.js"
import { SessionOperationLedger } from "../src/session-operation-ledger.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server.address().port
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

function body(overrides = {}) {
  return {
    clientRequestId: "handoff-request-1",
    directory: "/repo",
    targetAgentID: "pi",
    model: { providerID: "openai", modelID: "gpt-5.6-codex" },
    variant: "high",
    ...overrides
  }
}

async function post(port, payload = body()) {
  return fetch(`http://127.0.0.1:${port}/v1/agents/codex/session/source-native-1/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
}

async function withLedger(run) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-handoff-"))
  try {
    const ledger = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    return await run(ledger)
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
}

test("accepted handoff retry returns the same target native Session without creating another", async () => withLedger(async (operationLedger) => {
  let creates = 0
  const expected = {
    target: {
      machineID: "machine-1",
      agentID: "pi",
      sessionID: "pi-native-2",
      directory: "/repo"
    },
    link: {
      type: "handoff",
      source: {
        machineID: "machine-1",
        agentID: "codex",
        sessionID: "source-native-1",
        directory: "/repo"
      },
      target: {
        machineID: "machine-1",
        agentID: "pi",
        sessionID: "pi-native-2",
        directory: "/repo"
      },
      createdAt: "2026-08-24T14:00:00.000Z"
    }
  }
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession(sourceAgentID, sourceSessionID, input) {
      creates += 1
      assert.equal(sourceAgentID, "codex")
      assert.equal(sourceSessionID, "source-native-1")
      assert.equal(input.targetAgentID, "pi")
      assert.deepEqual(input.model, { providerID: "openai", modelID: "gpt-5.6-codex" })
      assert.equal(input.variant, "high")
      return expected
    }
  })
  const port = await listen(server)
  try {
    const first = await post(port)
    const retry = await post(port)
    assert.equal(first.status, 200)
    assert.equal(retry.status, 200)
    assert.deepEqual((await first.json()).result, expected)
    assert.deepEqual((await retry.json()).result, expected)
    assert.equal(creates, 1)
  } finally {
    await close(server)
  }
}))

test("handoff semantic changes conflict under the same durable request id", async () => withLedger(async (operationLedger) => {
  let creates = 0
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession() {
      creates += 1
      return { target: { machineID: "machine-1", agentID: "pi", sessionID: "pi-native-2", directory: "/repo" } }
    }
  })
  const port = await listen(server)
  try {
    assert.equal((await post(port)).status, 200)
    const conflict = await post(port, body({ targetAgentID: "omp" }))
    assert.equal(conflict.status, 409)
    assert.match((await conflict.json()).error, /already used for a different native Session operation/)
    assert.equal(creates, 1)
  } finally {
    await close(server)
  }
}))

test("target id checkpoint survives post-create enrichment failure and retry reuses that Session", async () => withLedger(async (operationLedger) => {
  let creates = 0
  const expected = {
    target: {
      machineID: "machine-1",
      agentID: "pi",
      sessionID: "pi-native-checkpointed",
      directory: "/repo"
    }
  }
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession(_sourceAgentID, _sourceSessionID, _input, { checkpoint }) {
      creates += 1
      // This is the critical daemon ordering: session/new already returned X, so X becomes durable
      // before any model/title/link work that may still fail.
      await checkpoint(expected)
      throw new Error("post-create link enrichment failed")
    }
  })
  const port = await listen(server)
  try {
    const first = await post(port)
    const retry = await post(port)
    assert.equal(first.status, 200)
    assert.equal(retry.status, 200)
    assert.deepEqual((await first.json()).result, expected)
    assert.deepEqual((await retry.json()).result, expected)
    assert.equal(creates, 1, "post-create failure must never create a second target Session")
  } finally {
    await close(server)
  }
}))

test("uncertain session creation retry can reconcile one unique target without replaying create", async () => withLedger(async (operationLedger) => {
  let creates = 0
  let reconciles = 0
  const recovery = {
    kind: "native-session-handoff-create",
    targetAgentID: "pi",
    directory: "/repo",
    beforeSessionIDs: ["pi-old-1"]
  }
  const expected = {
    target: {
      machineID: "machine-1",
      agentID: "pi",
      sessionID: "pi-native-recovered",
      directory: "/repo"
    }
  }
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession() {
      creates += 1
      const error = new Error("session/new response was lost")
      error.ambiguous = true
      error.recovery = recovery
      throw error
    },
    async reconcileHandoff(sourceAgentID, sourceSessionID, input, storedRecovery) {
      reconciles += 1
      assert.equal(sourceAgentID, "codex")
      assert.equal(sourceSessionID, "source-native-1")
      assert.equal(input.targetAgentID, "pi")
      assert.deepEqual(storedRecovery, recovery)
      return expected
    }
  })
  const port = await listen(server)
  try {
    const first = await post(port)
    assert.equal(first.status, 202)
    assert.equal((await first.json()).status, "uncertain")

    const retry = await post(port)
    assert.equal(retry.status, 200)
    const retryBody = await retry.json()
    assert.equal(retryBody.status, "accepted")
    assert.deepEqual(retryBody.result, expected)
    assert.equal(creates, 1)
    assert.equal(reconciles, 1)

    const stableRetry = await post(port)
    assert.equal(stableRetry.status, 200)
    assert.deepEqual((await stableRetry.json()).result, expected)
    assert.equal(creates, 1)
    assert.equal(reconciles, 1, "accepted reconciliation must become the durable ledger answer")
  } finally {
    await close(server)
  }
}))

test("ambiguous target creation is never automatically replayed", async () => withLedger(async (operationLedger) => {
  let creates = 0
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession() {
      creates += 1
      const error = new Error("target Session may already exist")
      error.ambiguous = true
      throw error
    }
  })
  const port = await listen(server)
  try {
    const first = await post(port)
    const retry = await post(port)
    assert.equal(first.status, 202)
    assert.equal((await first.json()).status, "uncertain")
    assert.equal(retry.status, 202)
    assert.equal((await retry.json()).status, "uncertain")
    assert.equal(creates, 1)
  } finally {
    await close(server)
  }
}))

test("handoff must actually cross agents", async () => withLedger(async (operationLedger) => {
  let creates = 0
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async handoffSession() { creates += 1 }
  })
  const port = await listen(server)
  try {
    const response = await post(port, body({ targetAgentID: "codex" }))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /different target agent/)
    assert.equal(creates, 0)
  } finally {
    await close(server)
  }
}))
