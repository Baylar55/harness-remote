import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// Managed OpenCode may need a lazy host start before its provider inventory is available. ACP
// adapters may need a first npx launch, authentication and one technical Session.
export const MODEL_CATALOG_TIMEOUT_MS = 30_000
export const ACP_MODEL_CATALOG_TIMEOUT_MS = 90_000
export const HTTP_MODEL_CATALOG_TTL_MS = 30_000
const ACP_VARIANT_PROBE_BUDGET_MS = 10_000
const ACP_VARIANT_REQUEST_TIMEOUT_MS = 2_000

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

function laterTimestamp(values) {
  const candidates = values.filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
  if (!candidates.length) return null
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
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

function newAcpScope(directory) {
  return {
    directory,
    cache: [],
    refreshedAt: null,
    lastAttemptAt: null,
    lastError: null,
    inFlight: null,
    sessionID: undefined,
    phase: "idle",
    variantProbe: { total: 0, completed: 0, incomplete: false, lastError: null }
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
    this.stateLoaded = false
    this.hiddenSessionIDs = new Set()
    this.scopes = new Map()
    this.onAgentExit = (error) => {
      const message = error instanceof Error ? error.message : String(error ?? "adapter exited")
      for (const scope of this.scopes.values()) {
        scope.lastError = message
        scope.sessionID = undefined
        scope.phase = "stopped"
        scope.cache = []
        scope.refreshedAt = null
      }
    }
    this.agent.on?.("exit", this.onAgentExit)
  }

  #scope(directory) {
    // Project paths and persisted Conversation workspaces are resolved and authorized by the
    // daemon before reaching the catalog. Keep that native path verbatim so a Windows daemon does
    // not reinterpret a trusted POSIX-style test/path string and so the cache key matches the
    // exact cwd sent to the harness.
    const resolved = typeof directory === "string" && directory ? directory : this.directory
    let scope = this.scopes.get(resolved)
    if (!scope) {
      scope = newAcpScope(resolved)
      this.scopes.set(resolved, scope)
    }
    return scope
  }

  #result(scope, models, stale = false, error) {
    return {
      models,
      stale,
      refreshedAt: scope.refreshedAt,
      ...(error ? { error } : {})
    }
  }

  #remember(scope, models) {
    scope.cache = models
    scope.refreshedAt = new Date().toISOString()
    scope.lastError = null
    return this.#result(scope, models, false)
  }

  #stale(scope, error) {
    scope.lastError = error instanceof Error ? error.message : String(error)
    if (!scope.cache.length) throw error
    return this.#result(scope, scope.cache, true, scope.lastError)
  }

  #resolveResult(result, model) {
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

  #remaining(deadline, phase) {
    const remaining = deadline - Date.now()
    if (remaining > 0) return remaining
    const error = new Error(`Agent ${this.agentID} model discovery timed out during ${phase} after ${this.timeoutMs}ms`)
    error.code = "model_catalog_timeout"
    throw error
  }

  async #loadState() {
    if (this.stateLoaded) return
    this.stateLoaded = true
    try {
      const state = JSON.parse(await readFile(this.stateFile, "utf8"))
      const sessionIDs = (state?.version === 3 || state?.version === 2) && Array.isArray(state.sessionIDs)
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
      version: 3,
      sessionIDs: [...this.hiddenSessionIDs],
      directories: [...this.scopes.keys()]
    }), { mode: 0o600 })
  }

  async #newCatalogSession(scope, deadline) {
    const created = await this.agent.request(
      "session/new",
      { cwd: scope.directory, mcpServers: [] },
      this.#remaining(deadline, "technical Session creation")
    )
    if (!created?.sessionId) throw new Error(`Agent ${this.agentID} did not return a catalog session id`)
    scope.sessionID = created.sessionId
    this.hiddenSessionIDs.add(created.sessionId)
    await this.#saveState()
    return created.configOptions
  }

  async #refreshOptions(scope, deadline) {
    scope.phase = "starting-adapter"
    await this.agent.start(this.#remaining(deadline, "adapter startup"))
    scope.phase = "loading-state"
    await this.#loadState()
    // Historical technical Sessions remain hidden but are never loaded as model authority. Each
    // authorized Project/cwd gets a fresh prompt-less technical Session for the current adapter
    // lifetime, so one project's provider/config state cannot become another project's catalog.
    scope.phase = "creating-session"
    return this.#newCatalogSession(scope, deadline)
  }

  async #probeVariants(scope, configOptions, catalogDeadline) {
    const baseModels = modelsFromConfigOptions(configOptions, this.agentID)
    const modelOption = configOptions?.find((item) => item?.id === "model")
    if (!baseModels.length || !this.variantConfigIDs.length || !scope.sessionID || !modelOption || !Array.isArray(modelOption.options)) {
      scope.variantProbe = { total: 0, completed: 0, incomplete: false, lastError: null }
      return baseModels
    }

    const candidates = modelOption.options.filter((candidate) => modelFromConfigCandidate(candidate, modelOption, this.agentID))
    const originalModel = modelOption.currentValue
    const ordered = [...candidates].sort((left, right) => {
      if (left?.value === originalModel) return -1
      if (right?.value === originalModel) return 1
      return 0
    })
    const probeDeadline = Math.min(catalogDeadline, Date.now() + ACP_VARIANT_PROBE_BUDGET_MS)
    const variants = []
    let currentModel = originalModel
    scope.variantProbe = { total: ordered.length, completed: 0, incomplete: false, lastError: null }

    for (const rawModel of ordered) {
      const base = modelFromConfigCandidate(rawModel, modelOption, this.agentID)
      if (!base) continue
      let effectiveOptions = configOptions
      if (rawModel.value !== currentModel) {
        const remaining = probeDeadline - Date.now()
        if (remaining <= 0) {
          scope.variantProbe.incomplete = true
          break
        }
        try {
          const changed = await this.agent.request("session/set_config_option", {
            sessionId: scope.sessionID,
            configId: "model",
            value: rawModel.value
          }, Math.max(1, Math.min(ACP_VARIANT_REQUEST_TIMEOUT_MS, remaining)))
          currentModel = rawModel.value
          if (Array.isArray(changed?.configOptions)) effectiveOptions = changed.configOptions
        } catch (error) {
          scope.variantProbe.incomplete = true
          scope.variantProbe.lastError = error instanceof Error ? error.message : String(error)
          scope.variantProbe.completed += 1
          continue
        }
      }
      const variantOption = this.variantConfigIDs
        .map((id) => effectiveOptions?.find((item) => item?.id === id))
        .find((option) => option && Array.isArray(option.options))
      if (variantOption) {
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
      scope.variantProbe.completed += 1
    }

    if (scope.variantProbe.completed < scope.variantProbe.total) scope.variantProbe.incomplete = true
    return dedupeModels([...baseModels, ...variants])
  }

  async #refreshCatalog(scope) {
    scope.lastAttemptAt = new Date().toISOString()
    const deadline = Date.now() + this.timeoutMs
    scope.variantProbe = { total: 0, completed: 0, incomplete: false, lastError: null }
    try {
      const options = await this.#refreshOptions(scope, deadline)
      const baseModels = modelsFromConfigOptions(options, this.agentID)
      if (!baseModels.length) throw new Error(`Agent ${this.agentID} did not advertise any models`)
      scope.phase = "probing-variants"
      // Base membership is the required result. Variant enrichment is bounded and may stop early;
      // a slow optional reasoning control must never make an otherwise valid catalog unusable.
      const models = await this.#probeVariants(scope, options, deadline)
      scope.phase = "ready"
      return this.#remember(scope, models)
    } catch (error) {
      scope.phase = "error"
      throw error
    }
  }

  async list({ allowStale = true, refresh = false, directory } = {}) {
    const scope = this.#scope(directory)
    if (!refresh && scope.cache.length) return this.#result(scope, scope.cache, false)
    if (!scope.inFlight) {
      const operation = this.#refreshCatalog(scope)
      let wrapped
      wrapped = operation.finally(() => {
        if (scope.inFlight === wrapped) scope.inFlight = null
      })
      scope.inFlight = wrapped
    }
    try {
      return await scope.inFlight
    } catch (error) {
      if (allowStale) return this.#stale(scope, error)
      scope.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async resolve(model, options = {}) {
    return this.#resolveResult(await this.list({ ...options, allowStale: false }), model)
  }

  async validate(model, options = {}) {
    await this.resolve(model, options)
  }

  #scopeDiagnostics(scope) {
    return {
      directory: scope.directory,
      cachedModels: scope.cache.length,
      refreshedAt: scope.refreshedAt,
      ageMs: catalogAge(scope.refreshedAt),
      inFlight: Boolean(scope.inFlight),
      lastAttemptAt: scope.lastAttemptAt,
      lastError: scope.lastError,
      phase: scope.phase,
      technicalSessionPersisted: Boolean(scope.sessionID),
      variantProbe: { ...scope.variantProbe }
    }
  }

  diagnostics({ directory } = {}) {
    if (directory) {
      const scope = this.#scope(directory)
      return {
        source: "acp-fresh-session-config-options",
        cacheScope: "project-cwd",
        ...this.#scopeDiagnostics(scope),
        timeoutMs: this.timeoutMs,
        adapterProcess: this.agent.diagnostics?.() ?? { processID: this.agent.processID },
        variantConfigIDs: this.variantConfigIDs
      }
    }

    const scopes = [...this.scopes.values()]
    const defaultScope = this.#scope(this.directory)
    const all = scopes.length ? scopes : [defaultScope]
    const refreshedAt = laterTimestamp(all.map((scope) => scope.refreshedAt))
    const lastAttemptAt = laterTimestamp(all.map((scope) => scope.lastAttemptAt))
    const errorScope = [...all].sort((left, right) => Date.parse(right.lastAttemptAt || 0) - Date.parse(left.lastAttemptAt || 0)).find((scope) => scope.lastError)
    return {
      source: "acp-fresh-session-config-options",
      cacheScope: "project-cwd",
      scopeCount: all.length,
      cachedModels: all.reduce((total, scope) => total + scope.cache.length, 0),
      refreshedAt,
      ageMs: catalogAge(refreshedAt),
      inFlight: all.some((scope) => Boolean(scope.inFlight)),
      lastAttemptAt,
      lastError: errorScope?.lastError ?? null,
      phase: defaultScope.phase,
      timeoutMs: this.timeoutMs,
      variantProbe: { ...defaultScope.variantProbe },
      adapterProcess: this.agent.diagnostics?.() ?? { processID: this.agent.processID },
      technicalSessionPersisted: all.some((scope) => Boolean(scope.sessionID)),
      variantConfigIDs: this.variantConfigIDs,
      scopes: all.map((scope) => this.#scopeDiagnostics(scope))
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
    // later rejects. OpenCode's runtime provider inventory is the picker authority.
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
      let wrapped
      wrapped = operation.finally(() => {
        if (this.inFlight === wrapped) this.inFlight = null
      })
      this.inFlight = wrapped
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
      cacheScope: "machine",
      timeoutMs: this.timeoutMs,
      ttlMs: this.ttlMs,
      hostProcessID: this.host.processID
    }
  }
  close() {}
}
