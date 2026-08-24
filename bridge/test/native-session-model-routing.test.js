import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { MachineDaemon, createMachineDaemonServer } from "../src/machine-daemon.js"

class FakeAcp extends EventEmitter {
  configCalls = []
  async start() {}
  close() {}
  async request(method, payload) { this.configCalls.push([method, payload]) }
}

class FakeHttpHost extends EventEmitter {
  host = "127.0.0.1"
  readinessHost = "127.0.0.1"
  port = 4999
  async start() { this.emit("available") }
  stop() { return true }
}

function passthroughServerOptions(daemon, primaryAcp, service) {
  let claimOptions
  createMachineDaemonServer({
    daemon,
    config: { backend: "codex", port: 4097 },
    primaryAcp,
    sessionOperationLedger: { marker: "ledger" },
    createServer: () => ({ acpService: service, emit() {} }),
    createRouter: () => ({ marker: "router" }),
    createClaimServer: (options) => { claimOptions = options; return { marker: "claim" } },
    createLaunchServer: ({ innerServer }) => innerServer,
    createModelServer: ({ innerServer }) => innerServer,
    createFinishServer: ({ innerServer }) => innerServer,
    createWorkThreadServerFactory: ({ innerServer }) => innerServer
  })
  return claimOptions
}

test("ACP native Session prompt resolves model and applies native variant config before prompting", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-acp", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({
    id: "codex",
    agent: acp,
    modelCatalog: {
      async resolve(model) {
        assert.deepEqual(model, { providerID: "openai", modelID: "gpt-5.6", variant: "high" })
        return { ...model, variantConfigId: "reasoning_effort" }
      }
    }
  })
  const prompts = []
  const claimOptions = passthroughServerOptions(daemon, acp, {
    async claimSession() {},
    async prompt(sessionID, text, model) { prompts.push([sessionID, text, model]) },
    async abort() {}
  })

  await claimOptions.promptSession("codex", "native-acp-model", {
    text: "Continue once",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high"
  })

  assert.deepEqual(acp.configCalls, [["session/set_config_option", {
    sessionId: "native-acp-model",
    configId: "reasoning_effort",
    value: "high"
  }]])
  assert.deepEqual(prompts, [["native-acp-model", "Continue once", "openai/gpt-5.6"]])
})

test("OpenCode native Session prompt preserves the existing parts model agent variant wire contract", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-http", name: "workstation" })
  const primaryAcp = new FakeAcp()
  const openCode = new FakeHttpHost()
  daemon.registerAcpHost({ id: "codex", agent: primaryAcp })
  daemon.registerManagedHttpHost({
    id: "opencode",
    host: openCode,
    eager: false,
    modelCatalog: {
      async resolve(model) { return model }
    }
  })
  const claimOptions = passthroughServerOptions(daemon, primaryAcp, {
    async claimSession() {},
    async prompt() {},
    async abort() {}
  })

  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options])
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
  }
  try {
    await claimOptions.promptSession("opencode", "native-http-model", {
      text: "Continue once",
      directory: "/repo",
      model: { providerID: "openai", modelID: "gpt-5.6" },
      variant: "high"
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /\/session\/native-http-model\/prompt_async\?directory=%2Frepo$/)
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    parts: [{ type: "text", text: "Continue once" }],
    model: { providerID: "openai", modelID: "gpt-5.6" },
    agent: "opencode",
    variant: "high"
  })
})