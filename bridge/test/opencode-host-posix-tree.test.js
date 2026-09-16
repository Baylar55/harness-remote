import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { ManagedOpenCodeHost } from "../src/opencode-host.js"

class FakeChild extends EventEmitter {
  pid = 7331
  exitCode = null
  signalCode = null
  killSignals = []

  kill(signal = "SIGTERM") {
    this.killSignals.push(signal)
    return true
  }
}

test("POSIX managed OpenCode owns and terminates its whole process group", async () => {
  const child = new FakeChild()
  const groupSignals = []
  let spawnOptions
  const host = new ManagedOpenCodeHost({
    username: "harness",
    password: "secret",
    platform: "linux",
    usePosixProcessGroup: true,
    spawnProcess: (_command, _args, options) => {
      spawnOptions = options
      return child
    },
    stopProcessGroup: (pid, signal) => {
      groupSignals.push([pid, signal])
      return true
    },
    waitUntilReady: async () => {}
  })

  await host.start()

  assert.equal(spawnOptions.detached, true, "managed POSIX OpenCode must be its own process-group leader")
  assert.equal(host.stop("SIGTERM"), true)
  assert.deepEqual(groupSignals, [[7331, "SIGTERM"]], "shutdown must target the managed process group")
  assert.deepEqual(child.killSignals, [], "group shutdown must not fall back to killing only the launcher")
})

test("POSIX group shutdown falls back to the launcher if the group signal itself fails", async () => {
  const child = new FakeChild()
  const host = new ManagedOpenCodeHost({
    username: "harness",
    password: "secret",
    platform: "linux",
    usePosixProcessGroup: true,
    spawnProcess: () => child,
    stopProcessGroup: () => { throw new Error("group already changed") },
    waitUntilReady: async () => {}
  })

  await host.start()
  assert.equal(host.stop("SIGTERM"), true)
  assert.deepEqual(child.killSignals, ["SIGTERM"])
})
