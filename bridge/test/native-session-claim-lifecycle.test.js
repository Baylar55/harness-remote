import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { MachineDaemon, createMachineDaemonServer } from "../src/machine-daemon.js"
import { SessionOperationLedger } from "../src/session-operation-ledger.js"

class FakeAcp extends EventEmitter {
  async start() {}
  close() {}
  async request() {}
}

function serverOptions(daemon, primaryAcp, service) {
  let claimOptions
  let diagnostics
  createMachineDaemonServer({
    daemon,
    config: { backend: "pi", port: 4097 },
    primaryAcp,
    sessionOperationLedger: { marker: "ledger" },
    createServer: () => ({ acpService: service, emit() {} }),
    createRouter: (options) => { diagnostics = options.diagnostics; return { marker: "router" } },
    createClaimServer: (options) => { claimOptions = options; return { marker: "claim" } },
    createLaunchServer: ({ innerServer }) => innerServer,
    createModelServer: ({ innerServer }) => innerServer,
    createFinishServer: ({ innerServer }) => innerServer,
    createWorkThreadServerFactory: ({ innerServer }) => innerServer
  })
  return { claimOptions, diagnostics }
}

/**
 * Writer ownership lives inside one live adapter process. Remembering a claim past an adapter exit
 * made Stop skip the reload it needs and then fail against a Session the new process never opened -
 * a contamination that outlived the Session that caused it.
 */
test("a claimed native Session is forgotten when its adapter exits, so Stop reloads it", async () => {
  const daemon = new MachineDaemon({ id: "machine-claim", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({ id: "pi", agent: acp })
  const claims = []
  const aborts = []
  const { claimOptions, diagnostics } = serverOptions(daemon, acp, {
    async claimSession(sessionID) { claims.push(sessionID) },
    async prompt() {},
    async abort(sessionID) { aborts.push(sessionID) }
  })

  await claimOptions.claimSession("pi", "native-1")
  assert.deepEqual(claims, ["native-1"])
  assert.deepEqual(diagnostics().nativeSessions.claimedWriters, [{ agentID: "pi", sessionID: "native-1" }])

  // A Stop on an already claimed Session must not reload it.
  await claimOptions.stopSession("pi", "native-1", { directory: "/repo" })
  assert.deepEqual(claims, ["native-1"], "an already claimed Session must not be claimed twice")
  assert.deepEqual(aborts, ["native-1"])

  // The adapter dies and takes every loaded Session with it.
  daemon.hostEntry("pi").host.emit("exit", new Error("ACP adapter exited (1)"))
  assert.deepEqual(diagnostics().nativeSessions.claimedWriters, [], "an adapter exit drops its writer claims")

  await claimOptions.stopSession("pi", "native-1", { directory: "/repo" })
  assert.deepEqual(claims, ["native-1", "native-1"], "Stop after an adapter restart must re-claim the Session")
  assert.deepEqual(aborts, ["native-1", "native-1"])
})

test("one agent's adapter exit does not drop another agent's writer claims", async () => {
  const daemon = new MachineDaemon({ id: "machine-claim-multi", name: "workstation" })
  const pi = new FakeAcp()
  const omp = new FakeAcp()
  daemon.registerAcpHost({ id: "pi", agent: pi })
  daemon.registerAcpHost({ id: "omp", agent: omp })
  const { claimOptions, diagnostics } = serverOptions(daemon, pi, {
    async claimSession() {},
    async prompt() {},
    async abort() {}
  })

  await claimOptions.claimSession("pi", "pi-1")
  await claimOptions.claimSession("omp", "omp-1")
  daemon.hostEntry("pi").host.emit("exit", new Error("ACP adapter exited (1)"))

  assert.deepEqual(
    diagnostics().nativeSessions.claimedWriters,
    [{ agentID: "omp", sessionID: "omp-1" }],
    "a harness crash must stay local to that harness"
  )
})

test("the operation ledger reports unresolved mutations without exposing prompt content", async () => {
  const ledger = new SessionOperationLedger({ machineID: "m1", stateDirectory: "/nonexistent-ledger-dir" })
  const empty = ledger.diagnostics()
  assert.deepEqual(empty.counts, { pending: 0, accepted: 0, uncertain: 0 })
  assert.equal(empty.unresolvedCount, 0)
  assert.equal(empty.oldestUnresolvedMs, null)
  assert.equal(empty.maxOperations, 1024)
  assert.equal(JSON.stringify(empty).includes("signature"), false)
})
