import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createSessionClaimServer } from "../src/session-claim-server.js"
import { SessionLinkStore } from "../src/session-link-store.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return server.address().port
}

test("machine Session-link endpoint mirrors and reads lineage", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "harness-link-route-"))
  const sessionLinkStore = new SessionLinkStore({ machineID: "machine-1", stateDirectory })
  const server = createSessionClaimServer({
    innerServer: new EventEmitter(),
    config: { username: "", password: "", corsOrigins: [] },
    sessionLinkStore
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = server.address().port
  const link = {
    type: "handoff",
    source: { machineID: "machine-1", agentID: "codex", sessionID: "source-1", directory: "/repo" },
    target: { machineID: "machine-1", agentID: "pi", sessionID: "target-2", directory: "/repo" },
    createdAt: "2026-08-29T07:00:00.000Z"
  }
  try {
    const registered = await fetch(`http://127.0.0.1:${port}/v1/session-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link })
    })
    assert.equal(registered.status, 200)
    const params = new URLSearchParams(link.source)
    const listed = await fetch(`http://127.0.0.1:${port}/v1/session-links?${params}`)
    assert.equal(listed.status, 200)
    assert.deepEqual((await listed.json()).links, [link])

    const enriched = { ...link, transferredContext: "User: persisted transfer" }
    const update = await fetch(`http://127.0.0.1:${port}/v1/session-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: enriched })
    })
    assert.equal(update.status, 200)
    const listedAgain = await fetch(`http://127.0.0.1:${port}/v1/session-links?${params}`)
    assert.deepEqual((await listedAgain.json()).links, [enriched])
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
