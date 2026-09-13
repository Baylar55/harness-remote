import assert from "node:assert/strict"
import { api } from "./api.ts"
import { lastNativeMessageModel, resolveNativeSessionTargetModel } from "./native-session-model.ts"

const originalLoadMessagePage = api.loadMessagePage
const originalListModels = api.listModels

function target(backend) {
  return {
    key: `machine-1:${backend}:ses-1`,
    ref: {
      machineID: "machine-1",
      agentID: backend,
      sessionID: "ses-1",
      directory: "/repo/project"
    },
    machineID: "machine-1",
    sessionID: "ses-1",
    directory: "/repo/project",
    title: "Session",
    agentID: backend,
    agentLabel: backend,
    backend,
    transport: backend === "opencode" ? "http" : "acp",
    config: {
      backend,
      agentId: backend,
      host: "machine.invalid",
      port: 4097,
      username: "harness",
      password: "secret"
    },
    external: false,
    modelsSupported: true,
    renameSupported: false,
    deleteSupported: false,
    model: null,
    requiresExplicitClaim: false,
    canStop: false
  }
}

const nativeMessages = [
  {
    info: {
      id: "user-old",
      role: "user",
      sessionID: "ses-1",
      model: { providerID: "openai", modelID: "gpt-old", variant: "low" }
    },
    parts: []
  },
  {
    info: {
      id: "user-current",
      role: "user",
      sessionID: "ses-1",
      model: { providerID: "anthropic", modelID: "claude-current", variant: "high" }
    },
    parts: []
  },
  {
    info: {
      id: "assistant-current",
      role: "assistant",
      sessionID: "ses-1",
      model: { providerID: "anthropic", modelID: "claude-current" }
    },
    parts: []
  }
]

assert.deepEqual(
  lastNativeMessageModel(nativeMessages),
  { providerID: "anthropic", modelID: "claude-current", variant: "high" },
  "the newest native model must win and may inherit only the matching adjacent user variant"
)

try {
  const pageCalls = []
  const modelCalls = []

  api.loadMessagePage = async (...args) => {
    pageCalls.push(args)
    return { messages: nativeMessages }
  }
  api.listModels = async (...args) => {
    modelCalls.push(args)
    return []
  }

  const openCodeTarget = target("opencode")
  const openCodeResolved = await resolveNativeSessionTargetModel(openCodeTarget)
  assert.deepEqual(openCodeResolved.model, {
    providerID: "anthropic",
    modelID: "claude-current",
    variant: "high"
  }, "OpenCode must recover the served model from native message metadata")
  assert.deepEqual(pageCalls[0], [
    openCodeTarget.config,
    "ses-1",
    "/repo/project",
    undefined,
    20,
    false
  ], "model recovery must read only the exact native Session page without forcing replay")
  assert.equal(modelCalls.length, 0, "OpenCode transcript recovery must not consult a second model authority")

  for (const backend of ["omp", "pi", "codex"]) {
    pageCalls.length = 0
    modelCalls.length = 0
    const expected = {
      providerID: `${backend}-provider`,
      modelID: `${backend}-model`,
      variant: `${backend}-variant`
    }
    api.loadMessagePage = async (...args) => {
      pageCalls.push(args)
      return { messages: [], model: expected }
    }

    const current = target(backend)
    const resolved = await resolveNativeSessionTargetModel(current)
    assert.deepEqual(resolved.model, expected, `${backend} must use the native page model as its authority`)
    assert.equal(pageCalls.length, 1)
    assert.equal(modelCalls.length, 0, `${backend} recovery must not invent a catalog fallback`)
  }

  pageCalls.length = 0
  modelCalls.length = 0
  api.loadMessagePage = async (...args) => {
    pageCalls.push(args)
    return { messages: [] }
  }
  api.listModels = async (...args) => {
    modelCalls.push(args)
    return [
      {
        providerID: "anthropic",
        providerName: "Anthropic",
        modelID: "claude-other",
        modelName: "Claude Other",
        isDefault: false
      },
      {
        providerID: "anthropic",
        providerName: "Anthropic",
        modelID: "claude-default",
        modelName: "Claude Default",
        variant: "high",
        isDefault: true
      }
    ]
  }

  const claudeTarget = target("claude")
  const claudeResolved = await resolveNativeSessionTargetModel(claudeTarget)
  assert.deepEqual(claudeResolved.model, {
    providerID: "anthropic",
    modelID: "claude-default",
    variant: "high"
  }, "Claude must recover its current model from the harness-advertised default when the page has none")
  assert.deepEqual(modelCalls, [[claudeTarget.config, "/repo/project", "ses-1"]], "Claude catalog recovery must stay directory and Session scoped")

  pageCalls.length = 0
  modelCalls.length = 0
  const unsupported = target("custom")
  const unsupportedResolved = await resolveNativeSessionTargetModel(unsupported)
  assert.equal(unsupportedResolved, unsupported, "an unsupported backend must remain untouched rather than gaining inferred model semantics")
  assert.equal(pageCalls.length, 0)
  assert.equal(modelCalls.length, 0)

  const failed = target("codex")
  api.loadMessagePage = async () => {
    throw new Error("native read unavailable")
  }
  const failedResolved = await resolveNativeSessionTargetModel(failed)
  assert.equal(failedResolved, failed, "model recovery failure must preserve the existing target instead of fabricating state")
} finally {
  api.loadMessagePage = originalLoadMessagePage
  api.listModels = originalListModels
}

console.log("native Session model recovery behavioral tests passed")
