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

test("remote handoff retry reuses the target Session", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-remote-handoff-"))
  const operationLedger = new SessionOperationLedger({ machineID: "machine-2", stateDirectory })
  let creates = 0
  const expected = {
    target: { machineID: "machine-2", agentID: "pi", sessionID: "pi-native-2", directory: "/repo" },
    link: {
      type: "handoff",
      source: { machineID: "machine-1", agentID: "codex", sessionID: "codex-native-1", directory: "/repo" },
      target: { machineID: "machine-2", agentID: "pi", sessionID: "pi-native-2", directory: "/repo" },
      createdAt: "2026-08-29T07:00:00.000Z"
    }
  }
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    operationLedger,
    async remoteHandoffSession(source, input) {
      creates += 1
      assert.equal(source.machineID, "machine-1")
      assert.equal(input.targetAgentID, "pi")
      return expected
    }
  })
  const port = await listen(server)
  const body = {
    clientRequestId: "remote-handoff-request-1",
    source: expected.link.source,
    directory: "/repo",
    targetAgentID: "pi"
  }
  try {
    const post = () => fetch(`http://127.0.0.1:${port}/v1/session-handoffs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    const first = await post()
    const retry = await post()
    assert.equal(first.status, 200)
    assert.equal(retry.status, 200)
    assert.deepEqual((await first.json()).result, expected)
    assert.deepEqual((await retry.json()).result, expected)
    assert.equal(creates, 1)
  } finally {
    await close(server)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
