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

async function withLedger(run) {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-model-"))
  try {
    return await run(new SessionOperationLedger({ machineID: "machine-model-test", stateDirectory }))
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
}

function body(overrides = {}) {
  return {
    clientRequestId: "request-model-1",
    text: "Continue with the selected model",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high",
    ...overrides
  }
}

async function post(port, value) {
  return fetch(`http://127.0.0.1:${port}/v1/agents/codex/session/native-model-1/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  })
}

test("native prompt forwards model and variant and replays the identical semantic mutation once", async () => withLedger(async (operationLedger) => {
  const calls = []
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async promptSession(agentID, sessionID, input) {
      calls.push({ agentID, sessionID, model: input.model, variant: input.variant })
    }
  })
  const port = await listen(server)
  try {
    assert.equal((await post(port, body())).status, 200)
    assert.equal((await post(port, body())).status, 200)
    assert.deepEqual(calls, [{
      agentID: "codex",
      sessionID: "native-model-1",
      model: { providerID: "openai", modelID: "gpt-5.6" },
      variant: "high"
    }])
  } finally {
    await close(server)
  }
}))

test("same native prompt request id cannot change model or variant", async () => withLedger(async (operationLedger) => {
  let dispatches = 0
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async promptSession() { dispatches += 1 }
  })
  const port = await listen(server)
  try {
    assert.equal((await post(port, body())).status, 200)

    const changedModel = await post(port, body({ model: { providerID: "openai", modelID: "gpt-5.6-mini" } }))
    assert.equal(changedModel.status, 409)

    const changedVariant = await post(port, body({ variant: "low" }))
    assert.equal(changedVariant.status, 409)
    assert.equal(dispatches, 1)
  } finally {
    await close(server)
  }
}))

test("malformed native prompt model is rejected before dispatch", async () => withLedger(async (operationLedger) => {
  let dispatches = 0
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async promptSession() { dispatches += 1 }
  })
  const port = await listen(server)
  try {
    const response = await post(port, body({ model: { providerID: "openai" } }))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /providerID and modelID/)
    assert.equal(dispatches, 0)
  } finally {
    await close(server)
  }
}))