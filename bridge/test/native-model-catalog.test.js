import assert from "node:assert/strict"
import test from "node:test"
import {
  NativeFilteredAcpModelCatalog,
  OmpNativeModelSource,
  PiNativeModelSource,
  modelsFromOmpJson,
  modelsFromPiListOutput
} from "../src/native-model-catalog.js"

const STALE = "deepseek-v4-flash-free"

test("PI native table parser returns only rows in the native picker", () => {
  const output = [
    "provider   model                     context  max-out  thinking  images",
    "opencode   current-live              200K     32K      yes       no",
    "anthropic  claude-sonnet-current     1M       64K      yes       yes"
  ].join("\n")
  const models = modelsFromPiListOutput(output)
  assert.deepEqual(models.map((model) => `${model.providerID}/${model.modelID}`), [
    "opencode/current-live",
    "anthropic/claude-sonnet-current"
  ])
  assert.equal(models.some((model) => model.modelID === STALE), false)
  assert.equal(models[0].contextLimit, 200_000)
  assert.equal(models[1].contextLimit, 1_000_000)
  assert.equal(models[1].attachments, true)
})

test("OMP JSON parser keeps exact live membership and native thinking efforts", () => {
  const models = modelsFromOmpJson({
    models: [{
      provider: "opencode",
      id: "current-live",
      name: "Current Live",
      contextWindow: 200_000,
      maxTokens: 32_000,
      reasoning: true,
      thinking: ["low", "high"],
      input: ["text", "image"],
      cost: { input: 0, output: 0 }
    }]
  })
  assert.deepEqual(models.map((model) => `${model.modelID}:${model.variant || "base"}`), [
    "current-live:base",
    "current-live:low",
    "current-live:high"
  ])
  assert.equal(models.some((model) => model.modelID === STALE), false)
  assert.equal(models[0].attachments, true)
  assert.equal(models[0].isFree, true)
  assert.equal(models[1].variantConfigId, "thinking")
})

test("PI source force-refreshes native catalogs before listing in the requested project", async () => {
  const calls = []
  const run = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd })
    if (args[0] === "update") return { stdout: "", stderr: "" }
    return {
      stdout: [
        "provider  model         context  max-out  thinking  images",
        "openai    current-live  128K     16K      yes       no"
      ].join("\n"),
      stderr: ""
    }
  }
  const source = new PiNativeModelSource({ command: "/usr/local/bin/pi", run })
  const result = await source.list({ directory: "/projects/alpha" })
  assert.deepEqual(calls, [
    { command: "/usr/local/bin/pi", args: ["update", "--models"], cwd: "/projects/alpha" },
    { command: "/usr/local/bin/pi", args: ["--list-models"], cwd: "/projects/alpha" }
  ])
  assert.deepEqual(result.models.map((model) => model.modelID), ["current-live"])
})

test("OMP source uses the structured forced-refresh command in the requested project", async () => {
  const calls = []
  const run = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd })
    return {
      stdout: JSON.stringify({ models: [{ provider: "openai", id: "current-live", name: "Current Live", reasoning: false, input: ["text"] }] }),
      stderr: ""
    }
  }
  const source = new OmpNativeModelSource({ command: "/usr/local/bin/omp", run })
  const result = await source.list({ directory: "/projects/beta" })
  assert.deepEqual(calls, [{
    command: "/usr/local/bin/omp",
    args: ["models", "refresh", "--json"],
    cwd: "/projects/beta"
  }])
  assert.deepEqual(result.models.map((model) => model.modelID), ["current-live"])
})

test("live native membership cannot be widened by stale ACP configOptions", async () => {
  const liveSource = {
    async list() {
      return {
        source: "native-test",
        models: [{ providerID: "opencode", providerName: "opencode", modelID: "current-live", modelName: "Current Live" }]
      }
    },
    diagnostics() { return { source: "native-test" } }
  }
  const inner = {
    hiddenSessionIDs: new Set(),
    async list() {
      return {
        models: [
          { providerID: "opencode", providerName: "OpenCode", modelID: STALE, modelName: "Deepseek V4 Flash Free", isDefault: true },
          { providerID: "opencode", providerName: "OpenCode", modelID: "current-live", modelName: "Current Live", isDefault: false },
          { providerID: "opencode", providerName: "OpenCode", modelID: STALE, modelName: "Deepseek V4 Flash Free", variant: "high", variantConfigId: "thinking" },
          { providerID: "opencode", providerName: "OpenCode", modelID: "current-live", modelName: "Current Live", variant: "high", variantConfigId: "thinking" }
        ]
      }
    },
    diagnostics() { return { source: "acp-test" } },
    close() {}
  }
  const catalog = new NativeFilteredAcpModelCatalog({ inner, liveSource, agentID: "pi", directory: "/repo" })
  const result = await catalog.list({ allowStale: false })
  assert.equal(result.models.some((model) => model.modelID === STALE), false, "ACP must never reintroduce a model absent from the native live list")
  assert.deepEqual(result.models.map((model) => `${model.modelID}:${model.variant || "base"}`), [
    "current-live:base",
    "current-live:high"
  ])
})

test("OMP native thinking variants prevent ACP from inventing a different effort set", async () => {
  const liveSource = {
    async list() {
      return {
        source: "omp-native-test",
        models: [
          { providerID: "openai", providerName: "openai", modelID: "live", modelName: "Live" },
          { providerID: "openai", providerName: "openai", modelID: "live", modelName: "Live", variant: "low", variantConfigId: "thinking" }
        ]
      }
    }
  }
  const inner = {
    hiddenSessionIDs: new Set(),
    async list() {
      return { models: [
        { providerID: "openai", providerName: "OpenAI", modelID: "live", modelName: "Live" },
        { providerID: "openai", providerName: "OpenAI", modelID: "live", modelName: "Live", variant: "xhigh", variantConfigId: "thinking" }
      ] }
    },
    close() {}
  }
  const catalog = new NativeFilteredAcpModelCatalog({ inner, liveSource, agentID: "omp", directory: "/repo" })
  const result = await catalog.list({ allowStale: false })
  assert.deepEqual(result.models.map((model) => model.variant || "base"), ["base", "low"])
})

test("native source failure never falls back to ACP-only membership", async () => {
  let acpCalls = 0
  const liveSource = { async list() { throw new Error("native refresh failed") } }
  const inner = {
    hiddenSessionIDs: new Set(),
    async list() { acpCalls += 1; return { models: [{ providerID: "opencode", modelID: STALE }] } },
    close() {}
  }
  const catalog = new NativeFilteredAcpModelCatalog({ inner, liveSource, agentID: "pi", directory: "/repo" })
  await assert.rejects(() => catalog.list({ allowStale: false }), /native refresh failed/)
  assert.equal(acpCalls, 0, "ACP membership must not be consulted when the native authority is unavailable")
})
