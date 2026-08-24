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
  const service = {
    async createSession(input) {
      created.push(input)
      return { id: "pi-native-new" }
    },
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
  assert.deepEqual(pi.configCalls, [["session/set_config_option", {
    sessionId: "pi-native-new",
    configId: "effort",
    value: "high"
  }]])
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
