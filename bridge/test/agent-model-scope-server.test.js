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

test("model endpoint resolves projectId to a server-owned project cwd", async () => {
  const calls = []
  const daemon = { async listModels(agentID, options) { calls.push({ agentID, options }); return modelResult() } }
  const projectCatalog = async () => [{ id: "project-1", path: "/safe/project-one" }]
  const innerServer = http.createServer((_request, response) => { response.writeHead(500); response.end() })
  const server = createAgentModelServer({ innerServer, config, daemon, taskStore: {}, projectCatalog })
  const base = await listen(server)
  try {
    const response = await fetch(`${base}/v1/agents/pi/models?projectId=project-1`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [{ agentID: "pi", options: { allowStale: true, refresh: false, directory: "/safe/project-one" } }])
  } finally { await close(server) }
})

test("model endpoint resolves workThreadId to its persisted workspace cwd", async () => {
  const calls = []
  const daemon = { async listModels(agentID, options) { calls.push({ agentID, options }); return modelResult() } }
  const taskStore = { async get(id) { return id === "conversation-1" ? { id, workspace: { path: "/safe/conversation-workspace" } } : null } }
  const innerServer = http.createServer((_request, response) => { response.writeHead(500); response.end() })
  const server = createAgentModelServer({ innerServer, config, daemon, taskStore, projectCatalog: async () => [] })
  const base = await listen(server)
  try {
    const response = await fetch(`${base}/v1/agents/omp/models?workThreadId=conversation-1`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [{ agentID: "omp", options: { allowStale: true, refresh: false, directory: "/safe/conversation-workspace" } }])
  } finally { await close(server) }
})

test("model endpoint never accepts a client supplied cwd as model authority", async () => {
  const calls = []
  const daemon = { async listModels(agentID, options) { calls.push({ agentID, options }); return modelResult() } }
  const innerServer = http.createServer((_request, response) => { response.writeHead(500); response.end() })
  const server = createAgentModelServer({ innerServer, config, daemon, taskStore: {}, projectCatalog: async () => [] })
  const base = await listen(server)
  try {
    const response = await fetch(`${base}/v1/agents/pi/models?cwd=%2Fetc`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [{ agentID: "pi", options: { allowStale: true, refresh: false } }])
  } finally { await close(server) }
})

test("model endpoint rejects ambiguous project and conversation scope", async () => {
  let calls = 0
  const daemon = { async listModels() { calls += 1; return modelResult() } }
  const innerServer = http.createServer((_request, response) => { response.writeHead(500); response.end() })
  const server = createAgentModelServer({ innerServer, config, daemon, taskStore: {}, projectCatalog: async () => [] })
  const base = await listen(server)
  try {
    const response = await fetch(`${base}/v1/agents/pi/models?projectId=p&workThreadId=w`, { headers })
    assert.equal(response.status, 400)
    assert.equal(calls, 0)
  } finally { await close(server) }
})
