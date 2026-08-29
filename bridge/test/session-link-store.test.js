import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { SessionLinkStore } from "../src/session-link-store.js"

const source = {
  machineID: "machine-1",
  agentID: "codex",
  sessionID: "codex-native-1",
  directory: "/repo"
}

const target = {
  machineID: "machine-1",
  agentID: "pi",
  sessionID: "pi-native-2",
  directory: "/repo"
}

test("handoff link survives restart and remains only metadata between real native Sessions", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-links-"))
  try {
    const first = new SessionLinkStore({ machineID: "machine-1", stateDirectory })
    const link = await first.addHandoff({ source, target, createdAt: "2026-08-24T14:00:00.000Z" })
    assert.deepEqual(link, {
      type: "handoff",
      source,
      target,
      createdAt: "2026-08-24T14:00:00.000Z"
    })

    const restarted = new SessionLinkStore({ machineID: "machine-1", stateDirectory })
    assert.deepEqual(await restarted.listFor(source), [link])
    assert.deepEqual(await restarted.listFor(target), [link])

    const duplicate = await restarted.addHandoff({ source, target, createdAt: "later" })
    assert.deepEqual(duplicate, link, "same native Session relationship must not be duplicated")
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test("Session links may cross machines when this machine is one endpoint", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-session-links-scope-"))
  try {
    const store = new SessionLinkStore({ machineID: "machine-1", stateDirectory })
    const link = await store.addHandoff({ source, target: { ...target, machineID: "machine-2" } })
    assert.equal(link.target.machineID, "machine-2")
    assert.deepEqual(await store.listFor(source), [link])
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
