import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// HTTP providers are already running and should fail quickly. ACP adapters may need their first
// `npx` launch, authentication, and a technical session before they can expose config options.
export const MODEL_CATALOG_TIMEOUT_MS = 8_000
export const ACP_MODEL_CATALOG_TIMEOUT_MS = 90_000
export const HTTP_MODEL_CATALOG_TTL_MS = 30_000

function withTimeout(promise, timeoutMs, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function splitModelValue(value, fallbackProviderID) {
  const separator = value.indexOf("/")
  return separator > 0
    ? { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
    : { providerID: fallbackProviderID, modelID: value }
}

function finiteNumber(value) {
  return Number.isFinite(value) ? Number(value) : undefined
}

function variantNames(model) {
  if (Array.isArray(model?.variants)) {
    return model.variants.flatMap((variant) => typeof variant === "string"
      ? variant ? [variant] : []
      : variant && typeof variant.id === "string" && variant.id ? [variant.id] : [])
  }
  if (model?.variants && typeof model.variants === "object") return Object.keys(model.variants)
  return []
}

function pricingMetadata(model) {
  const rawCosts = Array.isArray(model?.cost) ? model.cost : model?.cost && typeof model.cost === "object" ? [model.cost] : []
  const first = rawCosts.find((cost) => cost && typeof cost === "object")
  const inputCost = finiteNumber(first?.input)
  const outputCost = finiteNumber(first?.output)
  const explicitFree = model?.free === true || model?.isFree === true
  const hasKnownTokenCost = inputCost !== undefined || outputCost !== undefined
  const allAdvertisedTokenCostsZero = rawCosts.length > 0 && rawCosts.every((cost) => {
    if (!cost || typeof cost !== "object") return false
    const input = finiteNumber(cost.input)
    const output = finiteNumber(cost.output)
    return input !== undefined && output !== undefined && input === 0 && output === 0
  })
  const anyPositiveTokenCost = rawCosts.some((cost) => Number(cost?.input) > 0 || Number(cost?.output) > 0)
  return {
    ...(inputCost !== undefined ? { inputCost } : {}),
    ...(outputCost !== undefined ? { outputCost } : {}),
    ...(explicitFree || allAdvertisedTokenCostsZero ? { isFree: true } : anyPositiveTokenCost || hasKnownTokenCost ? { isFree: false } : {})
  }
}

function dedupeModels(models) {
  const seen = new Set()
  return models.filter((model) => {
    const key = `${model.providerID}|${model.modelID}|${model.variant || ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function modelFromConfigCandidate(candidate, option, fallbackProviderID) {
  if (typeof candidate?.value !== "string" || !candidate.value || candidate.disabled === true) return undefined
  const { providerID, modelID } = splitModelValue(candidate.value, fallbackProviderID)
  if (!providerID || !modelID) return undefined
  return {
    providerID,
    providerName: candidate.providerName || providerID,
    modelID,
    modelName: candidate.name ?? modelID,
    description: candidate.description || undefined,
    status: typeof candidate.status === "string" ? candidate.status : undefined,
    isFree: typeof candidate.free === "boolean" ? candidate.free : typeof candidate.isFree === "boolean" ? candidate.isFree : undefined,
    isDefault: candidate.value === option.currentValue
  }
}

export function modelsFromConfigOptions(configOptions, fallbackProviderID) {
  const option = configOptions?.find((item) => item?.id === "model")
  if (!option || !Array.isArray(option.options)) return []
  return dedupeModels(option.options.flatMap((candidate) => {
    const model = modelFromConfigCandidate(candidate, option, fallbackProviderID)
    return model ? [model] : []
  }))
}

export function modelsFromProvidersResponse(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : []
  const models = providers.flatMap((provider) => {
    if (!provider || typeof provider.id !== "string" || !provider.models || typeof provider.models !== "object") return []
    const defaultModel = payload?.default?.[provider.id]
    return Object.entries(provider.models).flatMap(([key, model]) => {
      if (!model || typeof model !== "object" || model.enabled === false) return []
      const modelID = typeof model.id === "string" && model.id ? model.id : key
      const base = {
        providerID: provider.id,
        providerName: typeof provider.name === "string" && provider.name ? provider.name : provider.id,
        modelID,
        modelName: typeof model.name === "string" && model.name ? model.name : modelID,
        description: typeof model.description === "string" && model.description ? model.description : undefined,
        status: typeof model.status === "string" ? model.status : undefined,
        contextLimit: Number.isFinite(model.limit?.context) ? model.limit.context : undefined,
        outputLimit: Number.isFinite(model.limit?.output) ? model.limit.output : undefined,
        tools: Boolean(model.capabilities?.toolcall || model.capabilities?.tools),
        attachments: Boolean(model.capabilities?.attachment),
        isDefault: defaultModel === key || defaultModel === modelID,
        ...pricingMetadata(model)
      }
      const variants = variantNames(model)
      return [base, ...variants.map((variant) => ({ ...base, variant, isDefault: false }))]
    })
  })
  return dedupeModels(models)
}

/** OpenCode's runtime provider inventory is the same source its native model command resolves. */
export function modelsFromRuntimeProvidersResponse(payload) {
  const all = Array.isArray(payload?.all) ? payload.all : []
  const hasConnectedInventory = Array.isArray(payload?.connected)
  const connected = new Set(hasConnectedInventory ? payload.connected.filter((value) => typeof value === "string") : [])
  const providers = hasConnectedInventory
    ? all.filter((provider) => provider && typeof provider.id === "string" && connected.has(provider.id))
    : all
  return modelsFromProvidersResponse({ providers, default: payload?.default })
}

function sameModel(left, right) {
  return left.providerID === right.providerID && left.modelID === right.modelID && (left.variant ?? "") === (right.variant ?? "")
}

function authorization(username, password) {
  if (!username && !password) return undefined
  return `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}`
}

function httpHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

function catalogAge(refreshedAt) {
  const value = Date.parse(refreshedAt ?? "")
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null
}

class CachedCatalog {
  cache = []
  refreshedAt = null
  lastAttemptAt = null
  lastError = null
  inFlight = null

  result(models, stale = false, error) {
    return { models, stale, refreshedAt: this.refreshedAt, ...(error ? { error } : {}) }
  }

  remember(models) {
    this.cache = models
    this.refreshedAt = new Date().toISOString()
    this.lastError = null
    return this.result(models, false)
  }

  clear() {
    this.cache = []
    this.refreshedAt = null
  }

  stale(error) {
    this.lastError = error instanceof Error ? error.message : String(error)
    if (!this.cache.length) throw error
    return this.result(this.cache, true, this.lastError)
  }

  resolveResult(result, model) {
    if (!model) return null
    const candidate = result.models.find((item) => sameModel(item, model))
    if (!candidate) {
      const suffix = model.variant ? ` (${model.variant})` : ""
      const error = new Error(`Selected model is no longer available: ${model.providerID}/${model.modelID}${suffix}`)
      error.code = "model_unavailable"
      throw error
    }
    return candidate
  }

  diagnosticsBase(source) {
    return {
      source,
      cachedModels: this.cache.length,
      refreshedAt: this.refreshedAt,
      ageMs: catalogAge(this.refreshedAt),
      inFlight: Boolean(this.inFlight),
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError
    }
  }
}

export class AcpAgentModelCatalog extends CachedCatalog {
  constructor({ agent, agentID, directory, stateDirectory, timeoutMs = ACP_MODEL_CATALOG_TIMEOUT_MS, variantConfigIDs = [] }) {
    super()
    this.agent = agent
    this.agentID = agentID
    this.directory = directory
    this.timeoutMs = timeoutMs
    this.variantConfigIDs = [...new Set(variantConfigIDs.filter((value) => typeof value === "string" && value))]
    this.stateFile = path.join(stateDirectory, `model-catalog-${agentID}.json`)
    this.sessionID = undefined
    this.stateLoaded = false
    this.hiddenSessionIDs = new Set()
    this.onAgentExit = (error) => {
      this.lastError = error instanceof Error ? error.message : String(error ?? "adapter exited")
      this.sessionID = undefined
      this.clear()
    }
    this.agent.on?.("exit", this.onAgentExit)
  }

  async #loadState() {
    if (this.stateLoaded) return
    this.stateLoaded = true
    try {
      const state = JSON.parse(await readFile(this.stateFile, "utf8"))
      const sessionIDs = state?.version === 2 && Array.isArray(state.sessionIDs)
        ? state.sessionIDs
        : state?.version === 1 && typeof state.sessionID === "string"
          ? [state.sessionID]
          : []
      for (const sessionID of sessionIDs) {
        if (typeof sessionID === "string" && sessionID) this.hiddenSessionIDs.add(sessionID)
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }

  async preloadState() {
    await this.#loadState()
    return this.hiddenSessionIDs
  }

  async #saveState() {
    await mkdir(path.dirname(this.stateFile), { recursive: true })
    await writeFile(this.stateFile, JSON.stringify({
      version: 2,
      sessionIDs: [...this.hiddenSessionIDs],
      directory: this.directory
    }), { mode: 0o600 })
  }

  async #newCatalogSession() {
    const created = await this.agent.request("session/new", { cwd: this.directory, mcpServers: [] }, this.timeoutMs)
    if (!created?.sessionId) throw new Error(`Agent ${this.agentID} did not return a catalog session id`)
    this.sessionID = created.sessionId
    this.hiddenSessionIDs.add(created.sessionId)
    await this.#saveState()
    return created.configOptions
  }

  async #refreshOptions() {
    await this.agent.start()
    await this.#loadState()
    // A historical ACP Session can legitimately retain the model options it was created with.
    // Reusing it across daemon restarts therefore turns removed models into a permanent catalog.
    // Old ids are loaded only so those technical Sessions stay hidden. Discovery always starts from
    // one fresh prompt-less Session for the current adapter process.
    return this.#newCatalogSession()
  }

  async #probeVariants(configOptions) {
    const baseModels = modelsFromConfigOptions(configOptions, this.agentID)
    if (!baseModels.length || !this.variantConfigIDs.length || !this.sessionID) return baseModels
    const modelOption = configOptions?.find((item) => item?.id === "model")
    if (!modelOption || !Array.isArray(modelOption.options)) return baseModels

    const originalModel = modelOption.currentValue
    const originalVariant = this.variantConfigIDs
      .map((id) => configOptions.find((item) => item?.id === id))
      .find((option) => typeof option?.currentValue === "string")
    const variants = []
    let currentModel = originalModel

    try {
      for (const rawModel of modelOption.options) {
        const base = modelFromConfigCandidate(rawModel, modelOption, this.agentID)
        if (!base) continue
        let effectiveOptions = configOptions
        if (rawModel.value !== currentModel) {
          try {
            const changed = await this.agent.request("session/set_config_option", {
              sessionId: this.sessionID,
              configId: "model",
              value: rawModel.value
            }, this.timeoutMs)
            currentModel = rawModel.value
            if (Array.isArray(changed?.configOptions)) effectiveOptions = changed.configOptions
          } catch {
            // The base model remains valid. A model-specific option that cannot be observed is not
            // guessed or copied from a different model.
            continue
          }
        }
        const variantOption = this.variantConfigIDs
          .map((id) => effectiveOptions?.find((item) => item?.id === id))
          .find((option) => option && Array.isArray(option.options))
        if (!variantOption) continue
        for (const candidate of variantOption.options) {
          if (typeof candidate?.value !== "string" || !candidate.value || candidate.disabled === true) continue
          variants.push({
            ...base,
            variant: candidate.value,
            variantName: candidate.name || candidate.value,
            variantConfigId: variantOption.id,
            isDefault: false
          })
        }
      }
    } finally {
      if (typeof originalModel === "string" && originalModel && currentModel !== originalModel) {
        try {
          await this.agent.request("session/set_config_option", {
            sessionId: this.sessionID,
            configId: "model",
            value: originalModel
          }, this.timeoutMs)
        } catch {}
      }
      if (originalVariant && typeof originalVariant.currentValue === "string" && originalVariant.currentValue) {
        try {
          await this.agent.request("session/set_config_option", {
            sessionId: this.sessionID,
            configId: originalVariant.id,
            value: originalVariant.currentValue
          }, this.timeoutMs)
        } catch {}
      }
    }

    return dedupeModels([...baseModels, ...variants])
  }

  async #refreshCatalog() {
    this.lastAttemptAt = new Date().toISOString()
    // AcpClient already applies bounded startup and request timeouts. Keeping this operation itself
    // single-flight is more important than racing it with another timer: a timed-out HTTP caller
    // must not spawn a second technical ACP session while the first one is still authenticating.
    const options = await this.#refreshOptions()
    const models = await this.#probeVariants(options)
    if (!models.length) throw new Error(`Agent ${this.agentID} did not advertise any models`)
    return this.remember(models)
  }

  async list({ allowStale = true, refresh = false } = {}) {
    // One fresh technical Session per adapter lifetime avoids both stale cross-restart configOptions
    // and unbounded technical Session growth. An explicit refresh is still available for diagnostics.
    if (!refresh && this.cache.length) return this.result(this.cache, false)
    if (!this.inFlight) {
      const operation = this.#refreshCatalog()
      this.inFlight = operation.finally(() => {
        if (this.inFlight === operation || this.inFlight === wrapped) this.inFlight = null
      })
      const wrapped = this.inFlight
    }
    try {
      return await this.inFlight
    } catch (error) {
      if (allowStale) return this.stale(error)
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async resolve(model) { return this.resolveResult(await this.list({ allowStale: false }), model) }
  async validate(model) { await this.resolve(model) }
  diagnostics() {
    return {
      ...this.diagnosticsBase("acp-fresh-session-config-options"),
      adapterProcess: this.agent.diagnostics?.() ?? { processID: this.agent.processID },
      technicalSessionPersisted: Boolean(this.sessionID),
      variantConfigIDs: this.variantConfigIDs
    }
  }
  close() {
    this.agent.off?.("exit", this.onAgentExit)
    this.agent.close?.()
  }
}

export class HttpAgentModelCatalog extends CachedCatalog {
  constructor({ host, agentID, fetchImpl = fetch, timeoutMs = MODEL_CATALOG_TIMEOUT_MS, ttlMs = HTTP_MODEL_CATALOG_TTL_MS }) {
    super()
    this.host = host
    this.agentID = agentID
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.ttlMs = ttlMs
    this.hiddenSessionIDs = new Set()
    this.source = "opencode-provider-runtime"
  }

  async #fetch(base, pathname, auth) {
    return this.fetchImpl(`${base}${pathname}`, {
      headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) }
    })
  }

  async #refresh() {
    this.lastAttemptAt = new Date().toISOString()
    await this.host.start?.()
    const host = this.host.readinessHost ?? this.host.host ?? "127.0.0.1"
    const base = `http://${httpHost(host)}:${this.host.port}`
    const auth = authorization(this.host.username, this.host.password)

    // `/config/providers` is configuration inventory and can retain entries that runtime resolution
    // later rejects. OpenCode's native model command resolves the runtime Provider.list() inventory,
    // exposed by `/provider` (legacy server) and `/api/provider` (v2 server).
    for (const pathname of ["/provider", "/api/provider"]) {
      const response = await this.#fetch(base, pathname, auth)
      if (response.status === 404 || response.status === 405) continue
      if (!response.ok) throw new Error(`Refreshing ${this.agentID} models from ${pathname} failed with HTTP ${response.status}`)
      const models = modelsFromRuntimeProvidersResponse(await response.json())
      if (!models.length) throw new Error(`Agent ${this.agentID} did not advertise any connected runtime models`)
      this.source = `opencode-runtime:${pathname}`
      return this.remember(models)
    }

    // Compatibility only for OpenCode versions from before the runtime provider route.
    const response = await this.#fetch(base, "/config/providers", auth)
    if (!response.ok) throw new Error(`Refreshing ${this.agentID} models failed with HTTP ${response.status}`)
    const models = modelsFromProvidersResponse(await response.json())
    if (!models.length) throw new Error(`Agent ${this.agentID} did not advertise any models`)
    this.source = "opencode-config-providers-legacy"
    return this.remember(models)
  }

  #fresh() {
    const refreshed = Date.parse(this.refreshedAt ?? "")
    return this.cache.length > 0 && Number.isFinite(refreshed) && Date.now() - refreshed < this.ttlMs
  }

  async list({ allowStale = true, refresh = false } = {}) {
    if (!refresh && this.#fresh()) return this.result(this.cache, false)
    if (!this.inFlight) {
      const operation = withTimeout(this.#refresh(), this.timeoutMs, `${this.agentID} model catalog`)
      this.inFlight = operation.finally(() => {
        if (this.inFlight === operation || this.inFlight === wrapped) this.inFlight = null
      })
      const wrapped = this.inFlight
    }
    try {
      return await this.inFlight
    } catch (error) {
      if (allowStale) return this.stale(error)
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async resolve(model) { return this.resolveResult(await this.list({ allowStale: false }), model) }
  async validate(model) { await this.resolve(model) }
  diagnostics() {
    return {
      ...this.diagnosticsBase(this.source),
      ttlMs: this.ttlMs,
      hostProcessID: this.host.processID
    }
  }
  close() {}
}
