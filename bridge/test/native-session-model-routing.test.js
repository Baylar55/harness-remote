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

test("ACP native Session prompt hands the raw model and variant to the exact AcpService", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-acp", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({
    id: "codex",
    agent: acp,
    modelCatalog: {
      async resolve() { throw new Error("the global catalog must not be consulted") }
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
    "high"
  ]])
})

test("ACP native Session command uses the exact AcpService model options too", async () => {
  const daemon = new MachineDaemon({ id: "machine-command-model-acp", name: "workstation" })
  const acp = new FakeAcp()
  daemon.registerAcpHost({
    id: "codex",
    agent: acp,
    modelCatalog: {
      async resolve() { throw new Error("the global catalog must not be consulted") }
    }
  })
  const prompts = []
  const claimOptions = passthroughServerOptions(daemon, acp, {
    async claimSession() {},
    async prompt(sessionID, text, model, attachments, variant) { prompts.push([sessionID, text, model, attachments, variant]) },
    async abort() {}
  })

  await claimOptions.commandSession("codex", "native-acp-command-model", {
    command: "help",
    arguments: "models",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high"
  })

  assert.deepEqual(acp.configCalls, [])
  assert.deepEqual(prompts, [[
    "native-acp-command-model",
    "/help models",
    "openai/gpt-5.6",
    [],
    "high"
  ]])
})

test("ACP native Session prompt remains usable when the global catalog rejects its retained model", async () => {
  const daemon = new MachineDaemon({ id: "machine-model-degraded", name: "workstation" })
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

  // The exact Session, not a machine-wide technical Session, validates this retained selection.
  assert.deepEqual(prompts, [["native-acp-degraded", "Continue once", "openai/gpt-5.6", "high"]])
})

test("ACP native Session prompt still reports a model the exact Session rejects", async () => {
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
    async prompt() { throw new Error("Harness model is not available: openai/gpt-5.6") },
    async abort() {}
  })

  await assert.rejects(
    claimOptions.promptSession("codex", "native-acp-gone", {
      text: "Continue once",
      directory: "/repo",
      model: { providerID: "openai", modelID: "gpt-5.6" }
    }),
    /Harness model is not available/
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

test("ACP cross-agent handoff checkpoints a bare target and defers model effort to the first prompt", async () => {
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
    async listSessions() { return [] },
    async createSession(input) {
      created.push(input)
      return { id: "pi-native-new", directory: "/repo" }
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

  const checkpoints = []
  const result = await claimOptions.handoffSession("codex", "codex-native-source", {
    targetAgentID: "pi",
    directory: "/repo",
    model: { providerID: "openai", modelID: "gpt-5.6" },
    variant: "high",
    title: "Continue in PI"
  }, { checkpoint: async (value) => checkpoints.push(structuredClone(value)) })

  assert.deepEqual(created, [{ directory: "/repo" }])
  assert.equal(checkpoints[0].target.sessionID, "pi-native-new")
  // Model + effort are intentionally not applied during resource creation. The first prompt carries
  // both through AcpService.prompt after the target identity is already durable.
  assert.deepEqual(pi.configCalls, [])
  assert.deepEqual(modelCalls, [])
  assert.deepEqual(links, [{
    source: { machineID: "machine-handoff-acp", agentID: "codex", sessionID: "codex-native-source", directory: "/repo" },
    target: { machineID: "machine-handoff-acp", agentID: "pi", sessionID: "pi-native-new", directory: "/repo" }
  }])
  assert.equal(result.target.sessionID, "pi-native-new")
})

test("OpenCode cross-agent handoff snapshots Sessions then creates a bare recoverable target", async () => {
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
  globalThis.fetch = async (url, options = {}) => {
    calls.push([String(url), options])
    if ((options.method || "GET") === "GET") {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
    }
    return new Response(JSON.stringify({ id: "opencode-native-new" }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  let result
  const checkpoints = []
  try {
    result = await claimOptions.handoffSession("codex", "codex-native-source", {
      targetAgentID: "opencode",
      directory: "/repo",
      model: { providerID: "openai", modelID: "gpt-5.6" },
      variant: "high",
      title: "Continue in OpenCode"
    }, { checkpoint: async (value) => checkpoints.push(structuredClone(value)) })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 2)
  assert.match(calls[0][0], /\/session\?directory=%2Frepo$/)
  assert.equal(calls[0][1].method, "GET")
  assert.match(calls[1][0], /\/session\?directory=%2Frepo$/)
  assert.equal(calls[1][1].method, "POST")
  assert.deepEqual(JSON.parse(calls[1][1].body), {})
  assert.equal(checkpoints[0].target.sessionID, "opencode-native-new")
  assert.deepEqual(links, [{
    source: { machineID: "machine-handoff-http", agentID: "codex", sessionID: "codex-native-source", directory: "/repo" },
    target: { machineID: "machine-handoff-http", agentID: "opencode", sessionID: "opencode-native-new", directory: "/repo" }
  }])
  assert.equal(result.target.sessionID, "opencode-native-new")
})

test("ACP native Session prompt neither waits for nor loses a variant to a cold global catalog", async () => {
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

  assert.ok(waited < 1_000, `sending must not block on unrelated global discovery (waited ${waited}ms)`)
  assert.deepEqual(prompts, [["openai/gpt-5.6", "high"]])
  assert.equal(resolveDiscovery, undefined, "the global catalog must not be started for an existing ACP Session")
})
