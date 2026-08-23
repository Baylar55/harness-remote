import assert from "node:assert/strict"
import test from "node:test"
import { NativeFilteredModelCatalog, modelKeysFromNativeList } from "../src/native-filtered-model-catalog.js"

test("native model table parser accepts provider rows and canonical selectors", () => {
  const keys = modelKeysFromNativeList(`
provider  model                         context  max-out
opencode  moonshotai/kimi-k3           256K     32K
openai    gpt-5.2-codex                 400K     64K
canonical/model-x                       200K     32K
`)
  assert.equal(keys.has("opencode/moonshotai/kimi-k3"), true)
  assert.equal(keys.has("openai/gpt-5.2-codex"), true)
  assert.equal(keys.has("canonical/model-x"), true)
  assert.equal(keys.has("provider/model"), false)
})

test("native harness membership removes stale ACP models without refreshing the ACP session", async () => {
  let nativeOutput = `provider model\nopencode current\nopencode removed\n`
  let baseCalls = 0
  const catalog = {
    hiddenSessionIDs: new Set(["technical"]),
    async list() {
      baseCalls += 1
      return {
        models: [
          { providerID: "opencode", modelID: "current", modelName: "Current" },
          { providerID: "opencode", modelID: "current", modelName: "Current", variant: "high" },
          { providerID: "opencode", modelID: "removed", modelName: "Removed" }
        ],
        stale: false,
        refreshedAt: "2026-08-23T00:00:00.000Z"
      }
    },
    diagnostics() { return { source: "acp-config-options", cachedModels: 3 } },
    close() {}
  }
  const filtered = new NativeFilteredModelCatalog({
    catalog,
    command: "pi",
    cwd: "/repo",
    execFileImpl: async () => ({ stdout: nativeOutput })
  })

  const first = await filtered.list()
  assert.deepEqual(first.models.map((model) => `${model.modelID}:${model.variant ?? "base"}`), ["current:base", "current:high", "removed:base"])

  nativeOutput = `provider model\nopencode current\n`
  const second = await filtered.list()
  assert.deepEqual(second.models.map((model) => `${model.modelID}:${model.variant ?? "base"}`), ["current:base", "current:high"])
  assert.equal(baseCalls, 2)
  await assert.rejects(
    () => filtered.resolve({ providerID: "opencode", modelID: "removed" }),
    (error) => error?.code === "model_unavailable"
  )
  assert.equal(filtered.hiddenSessionIDs.has("technical"), true)
})

test("native catalog failure never falls back to unfiltered ACP models", async () => {
  const catalog = {
    hiddenSessionIDs: new Set(),
    async list() {
      return { models: [{ providerID: "opencode", modelID: "stale" }], stale: false, refreshedAt: null }
    },
    diagnostics() { return { source: "acp-config-options" } }
  }
  const filtered = new NativeFilteredModelCatalog({
    catalog,
    command: "omp",
    execFileImpl: async () => { throw new Error("native command failed") }
  })
  await assert.rejects(() => filtered.list({ allowStale: true }), /native command failed/)
})
