import assert from "node:assert/strict"
import http from "node:http"
import test from "node:test"
import { createAgentModelServer } from "../src/agent-model-server.js"

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const config = { username: "harness", password: "secret", corsOrigins: [] }
const headers = { Authorization: `Basic ${Buffer.from("harness:secret").toString("base64")}` }

function modelResult() {
  return { models: [{ providerID: "provider", providerName: "Provider", modelID: "model", modelName: "Model" }], stale: false, refreshedAt: null }
}

test("model endpoint keeps ACP discovery machine scoped when project or conversation hints are present", async () => {
  const calls = []
  const daemon = { async listModels(agentID, options) { calls.push({ agentID, options }); return modelResult() } }
  const innerServer = http.createServer((_request, response) => { response.writeHead(500); response.end() })
  const server = createAgentModelServer({ innerServer, config, daemon, taskStore: {} })
  const base = await listen(server)
  try {
    for (const path of [
      "/v1/agents/pi/models?projectId=project-1",
      "/v1/agents/codex/models?workThreadId=conversation-1",
      "/v1/agents/claude/models?projectId=p&workThreadId=w",
      "/v1/agents/omp/models?cwd=%2Fetc"
    ]) {
      const response = await fetch(`${base}${path}`, { headers })
      assert.equal(response.status, 200)
    }

    assert.deepEqual(calls, [
      { agentID: "pi", options: { allowStale: true, refresh: false } },
      { agentID: "codex", options: { allowStale: true, refresh: false } },
      { agentID: "claude", options: { allowStale: true, refresh: false } },
      { agentID: "omp", options: { allowStale: true, refresh: false } }
    ])
  } finally { await close(server) }
})
