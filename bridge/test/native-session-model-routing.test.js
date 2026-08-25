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

function passthroughServerOptions(daemon, primaryAcp, service, sessionLinkStore = { async addHandoff({ source, target }) { return { type: "handoff", source, target, createdAt: "test" } } }) {
  let claimOptions
  createMachineDaemonServer({
    daemon,
    config: { backend: "codex", port: 4097 },
    primaryAcp,
    sessionOperationLedger: { marker: "ledger" },
    sessionLinkStore,
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

test("ACP native Session prompt hands model and native variant to AcpService so the variant is applied after the model", async () => {
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
    async prompt(sessionID, text, model, attachments, variant) { prompts.push([sessionID, text, model, attachments, variant]) },
    async abort() {}
  })

  await claimOptions.promptSession("codex", "native-acp-model", {
    text: "Continue once",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high"
  })

  // The daemon must not issue its own set_config_option: doing so applied the variant before the
  // model, and a harness that resets dependent controls on model change then dropped it silently.
  assert.deepEqual(acp.configCalls, [])
  assert.deepEqual(prompts, [[
    "native-acp-model",
    "Continue once",
    "openai/gpt-5.6",
    [],
    { configId: "reasoning_effort", value: "high" }
  ]])
})

test("ACP native Session prompt keeps a Session usable when model discovery fails for a non-catalog reason", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-degraded", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({
    id: "codex",
    agent: acp,
    modelCatalog: {
      async resolve() { throw new Error("codex model catalog timed out after 90000ms") }
    }
  })
  const prompts = []
  const claimOptions = passthroughServerOptions(daemon, acp, {
    async claimSession() {},
    async prompt(sessionID, text, model, attachments, variant) { prompts.push([sessionID, text, model, variant]) },
    async abort() {}
  })

  await claimOptions.promptSession("codex", "native-acp-degraded", {
    text: "Continue once",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high"
  })

  // The requested model still reaches the harness; only the variant enrichment is lost.
  assert.deepEqual(prompts, [["native-acp-degraded", "Continue once", "openai/gpt-5.6", undefined]])
})

test("ACP native Session prompt still rejects a model the catalog says is gone", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-gone", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({
    id: "codex",
    agent: acp,
    modelCatalog: {
      async resolve() {
        const error = new Error("Selected model is no longer available: openai/gpt-5.6")
        error.code = "model_unavailable"
        throw error
      }
    }
  })
  const claimOptions = passthroughServerOptions(daemon, acp, {
    async claimSession() {},
    async prompt() { throw new Error("prompt must not be dispatched") },
    async abort() {}
  })

  await assert.rejects(
    claimOptions.promptSession("codex", "native-acp-gone", {
      text: "Continue once",
      directory: "/repo",
      model: { providerID: "openai", modelID: "gpt-5.6" }
    }),
    /no longer available/
  )
})

test("OpenCode native Session prompt preserves parts, model and variant without inventing an internal agent", async () => {
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
    variant: "high"
  })
})

test("ACP cross-agent handoff creates one real target Session, applies effort, and stores only a native Session link", async () => {
  const daemon = new MachineDaemon({ id: "machine-handoff-acp", name: "workstation" })
  const codex = new FakeAcp()
  const pi = new FakeAcp()
  daemon.registerAcpHost({ id: "codex", agent: codex })
  daemon.registerAcpHost({
    id: "pi",
    agent: pi,
    modelCatalog: {
      async resolve(model) { return { ...model, variantConfigId: "effort" } }
    }
  })
  const created = []
  const links = []
  const modelCalls = []
  const service = {
    async createSession(input) {
      created.push(input)
      return { id: "pi-native-new" }
    },
    async setModel(sessionID, model, variant) { modelCalls.push([sessionID, model, variant]) },
    async claimSession() {},
    async prompt() {},
    async abort() {}
  }
  const claimOptions = passthroughServerOptions(daemon, codex, service, {
    async addHandoff(value) {
      links.push(value)
      return { type: "handoff", ...value, createdAt: "test" }
    }
  })

  const result = await claimOptions.handoffSession("codex", "codex-native-source", {
    targetAgentID: "pi",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high",
    title: "Continue in PI"
  })

  assert.deepEqual(created, [{ directory: "/repo", title: "Continue in PI", model: "openai/gpt-5.6" }])
  // The variant goes through the owning service, which applies it after the model, not as a raw
  // adapter request that races the target Session's own configOptions load.
  assert.deepEqual(pi.configCalls, [])
  assert.deepEqual(modelCalls, [["pi-native-new", "openai/gpt-5.6", { configId: "effort", value: "high" }]])
  assert.deepEqual(links, [{
    source: { machineID: "machine-handoff-acp", agentID: "codex", sessionID: "codex-native-source", directory: "/repo" },
    target: { machineID: "machine-handoff-acp", agentID: "pi", sessionID: "pi-native-new", directory: "/repo" }
  }])
  assert.equal(result.target.sessionID, "pi-native-new")
})

test("OpenCode cross-agent handoff uses native Session creation with model and variant and stores the link", async () => {
  const daemon = new MachineDaemon({ id: "machine-handoff-http", name: "workstation" })
  const codex = new FakeAcp()
  const openCode = new FakeHttpHost()
  daemon.registerAcpHost({ id: "codex", agent: codex })
  daemon.registerManagedHttpHost({
    id: "opencode",
    host: openCode,
    eager: false,
    modelCatalog: { async resolve(model) { return model } }
  })
  const links = []
  const claimOptions = passthroughServerOptions(daemon, codex, {
    async claimSession() {},
    async prompt() {},
    async abort() {}
  }, {
    async addHandoff(value) {
      links.push(value)
      return { type: "handoff", ...value, createdAt: "test" }
    }
  })

  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options])
    return new Response(JSON.stringify({ id: "opencode-native-new" }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  let result
  try {
    result = await claimOptions.handoffSession("codex", "codex-native-source", {
      targetAgentID: "opencode",
      directory: "/repo",
      model: { providerID: "openai", modelID: "gpt-5.6" },
      variant: "high",
      title: "Continue in OpenCode"
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  assert.match(calls[0][0], /\/session\?directory=%2Frepo$/)
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    title: "Continue in OpenCode",
    model: { providerID: "openai", id: "gpt-5.6", variant: "high" }
  })
  assert.deepEqual(links, [{
    source: { machineID: "machine-handoff-http", agentID: "codex", sessionID: "codex-native-source", directory: "/repo" },
    target: { machineID: "machine-handoff-http", agentID: "opencode", sessionID: "opencode-native-new", directory: "/repo" }
  }])
  assert.equal(result.target.sessionID, "opencode-native-new")
})

test("ACP native Session prompt does not wait out a cold catalog's whole discovery budget", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-cold", name: "workstation" })
  const acp = new FakeAcp()
  let resolveDiscovery
  daemon.registerAcpHost({
    id: "pi",
    agent: acp,
    modelCatalog: {
      // A cold ACP adapter can legitimately take far longer than a person will wait.
      resolve() { return new Promise((resolve) => { resolveDiscovery = resolve }) }
    }
  })
  const prompts = []
  const claimOptions = passthroughServerOptions(daemon, acp, {
    async claimSession() {},
    async prompt(sessionID, text, model, attachments, variant) { prompts.push([model, variant]) },
    async abort() {}
  })

  const started = Date.now()
  await claimOptions.promptSession("pi", "native-cold", {
    text: "Continue once",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high"
  })
  const waited = Date.now() - started

  assert.ok(waited < 30_000, `sending must not block on cold discovery (waited ${waited}ms)`)
  // The requested model still reaches the harness; only the variant enrichment is deferred.
  assert.deepEqual(prompts, [["openai/gpt-5.6", undefined]])
  resolveDiscovery?.({ providerID: "openai", modelID: "gpt-5.6" })
})
