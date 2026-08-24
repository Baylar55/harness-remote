import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { SessionOperationLedger } from "../src/session-operation-ledger.js"

function input(overrides = {}) {
  return {
    agentID: "codex",
    sessionID: "native-1",
    clientRequestId: "request-1",
    signature: "signature-1",
    ...overrides
  }
}

test("accepted native Session prompt survives daemon restart and deduplicates retry", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-ledger-"))
  try {
    const first = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    assert.equal((await first.begin(input())).duplicate, false)
    await first.accept(input())

    const restarted = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    const replay = await restarted.begin(input())
    assert.equal(replay.duplicate, true)
    assert.equal(replay.state, "accepted")
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test("pending operation survives restart and is never automatically replayed", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-pending-"))
  try {
    const first = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    await first.begin(input())

    const restarted = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    const replay = await restarted.begin(input())
    assert.equal(replay.duplicate, true)
    assert.equal(replay.state, "pending")
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test("same client request id cannot be reused for different prompt payload", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-conflict-"))
  try {
    const ledger = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    await ledger.begin(input())
    await assert.rejects(
      () => ledger.begin(input({ signature: "different-signature" })),
      (error) => error.code === "idempotency_conflict"
    )
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test("safe pre-dispatch failure removes the pending record while ambiguous failure preserves it", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-failure-"))
  try {
    const ledger = new SessionOperationLedger({ machineID: "machine-1", stateDirectory })
    await ledger.begin(input())
    await ledger.fail({ agentID: "codex", sessionID: "native-1", clientRequestId: "request-1", ambiguous: false })
    assert.equal(await ledger.get(input()), undefined)

    const uncertain = input({ clientRequestId: "request-2" })
    await ledger.begin(uncertain)
    await ledger.fail({ agentID: uncertain.agentID, sessionID: uncertain.sessionID, clientRequestId: uncertain.clientRequestId, ambiguous: true })
    assert.equal((await ledger.get(uncertain)).state, "uncertain")
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
