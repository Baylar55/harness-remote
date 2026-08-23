import { spawn } from "node:child_process"

export const NATIVE_MODEL_CATALOG_TIMEOUT_MS = 30_000
export const NATIVE_MODEL_CATALOG_TTL_MS = 30_000
const MAX_CAPTURE_CHARS = 8 * 1024 * 1024
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g

function stripAnsi(value) {
  return String(value ?? "").replace(ANSI_ESCAPE, "")
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk}`
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS)
}

export function runNativeCommand(command, args, { cwd, timeoutMs = NATIVE_MODEL_CATALOG_TIMEOUT_MS, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnProcess(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill("SIGTERM") } catch {}
      const error = new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`)
      error.code = "model_catalog_timeout"
      reject(error)
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.setEncoding?.("utf8")
    child.stderr?.setEncoding?.("utf8")
    child.stdout?.on?.("data", (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr?.on?.("data", (chunk) => { stderr = appendBounded(stderr, chunk) })
    child.once?.("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once?.("exit", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      const detail = stripAnsi(stderr).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ")
      reject(new Error(`${command} ${args.join(" ")} exited (${code ?? "unknown"}${signal ? `, ${signal}` : ""})${detail ? `: ${detail}` : ""}`))
    })
  })
}

function finiteNumber(value) {
  return Number.isFinite(value) ? Number(value) : undefined
}

function pricing(cost) {
  if (!cost || typeof cost !== "object") return {}
  const inputCost = finiteNumber(cost.input)
  const outputCost = finiteNumber(cost.output)
  const known = inputCost !== undefined || outputCost !== undefined
  return {
    ...(inputCost !== undefined ? { inputCost } : {}),
    ...(outputCost !== undefined ? { outputCost } : {}),
    ...(known ? { isFree: Number(inputCost ?? 0) === 0 && Number(outputCost ?? 0) === 0 } : {})
  }
}

function dedupe(models) {
  const seen = new Set()
  return models.filter((model) => {
    const key = `${model.providerID}|${model.modelID}|${model.variant || ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseCompactNumber(value) {
  const text = String(value ?? "").trim().toUpperCase()
  if (!text || text === "-") return undefined
  const match = /^(\d+(?:\.\d+)?)([KM])?$/.exec(text)
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base)) return undefined
  return Math.round(base * (match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1))
}

export function modelsFromPiListOutput(output) {
  const lines = stripAnsi(output).split(/\r?\n/)
  const header = lines.findIndex((line) => /^\s*provider\s{2,}model\s{2,}context\s{2,}max-out\s{2,}thinking\s{2,}images\s*$/i.test(line))
  if (header < 0) return []
  const models = []
  for (const raw of lines.slice(header + 1)) {
    const line = raw.trim()
    if (!line) continue
    const columns = line.split(/\s{2,}/)
    if (columns.length < 6) continue
    const [providerID, modelID, context, maxOut, thinking, images] = columns
    if (!providerID || !modelID) continue
    models.push({
      providerID,
      providerName: providerID,
      modelID,
      modelName: modelID,
      ...(parseCompactNumber(context) !== undefined ? { contextLimit: parseCompactNumber(context) } : {}),
      ...(parseCompactNumber(maxOut) !== undefined ? { outputLimit: parseCompactNumber(maxOut) } : {}),
      attachments: images.toLowerCase() === "yes",
      reasoning: thinking.toLowerCase() === "yes"
    })
  }
  return dedupe(models)
}

function parseJsonOutput(output) {
  const text = stripAnsi(output).trim()
  if (!text) throw new Error("Native model command returned an empty response")
  try { return JSON.parse(text) } catch {}
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]) } catch {}
  }
  throw new Error("Native model command did not return valid JSON")
}

export function modelsFromOmpJson(payload) {
  const rows = Array.isArray(payload?.models) ? payload.models : []
  const models = []
  for (const row of rows) {
    if (!row || typeof row.provider !== "string" || typeof row.id !== "string" || !row.provider || !row.id) continue
    const base = {
      providerID: row.provider,
      providerName: row.provider,
      modelID: row.id,
      modelName: typeof row.name === "string" && row.name ? row.name : row.id,
      ...(finiteNumber(row.contextWindow) !== undefined ? { contextLimit: finiteNumber(row.contextWindow) } : {}),
      ...(finiteNumber(row.maxTokens) !== undefined ? { outputLimit: finiteNumber(row.maxTokens) } : {}),
      attachments: Array.isArray(row.input) && row.input.includes("image"),
      reasoning: row.reasoning === true,
      ...pricing(row.cost)
    }
    models.push(base)
    if (Array.isArray(row.thinking)) {
      for (const effort of row.thinking) {
        if (typeof effort !== "string" || !effort) continue
        models.push({ ...base, variant: effort, variantName: effort, variantConfigId: "thinking", isDefault: false })
      }
    }
  }
  return dedupe(models)
}

export class PiNativeModelSource {
  constructor({ command, run = runNativeCommand, timeoutMs = NATIVE_MODEL_CATALOG_TIMEOUT_MS } = {}) {
    this.command = command
    this.run = run
    this.timeoutMs = timeoutMs
    this.lastAttemptAt = null
    this.lastError = null
  }

  async list({ directory }) {
    if (!this.command) throw new Error("PI executable was not found on PATH")
    this.lastAttemptAt = new Date().toISOString()
    try {
      await this.run(this.command, ["update", "--models"], { cwd: directory, timeoutMs: this.timeoutMs })
      const listed = await this.run(this.command, ["--list-models"], { cwd: directory, timeoutMs: this.timeoutMs })
      const models = modelsFromPiListOutput(listed.stdout)
      if (!models.length) throw new Error("PI native model picker did not report any available models")
      this.lastError = null
      return { models, source: "pi-native:update-models+list-models" }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  diagnostics() {
    return { source: "pi-native", commandResolved: Boolean(this.command), lastAttemptAt: this.lastAttemptAt, lastError: this.lastError }
  }
}

export class OmpNativeModelSource {
  constructor({ command, run = runNativeCommand, timeoutMs = NATIVE_MODEL_CATALOG_TIMEOUT_MS } = {}) {
    this.command = command
    this.run = run
    this.timeoutMs = timeoutMs
    this.lastAttemptAt = null
    this.lastError = null
  }

  async list({ directory }) {
    if (!this.command) throw new Error("OMP executable was not found on PATH")
    this.lastAttemptAt = new Date().toISOString()
    try {
      const listed = await this.run(this.command, ["models", "refresh", "--json"], { cwd: directory, timeoutMs: this.timeoutMs })
      const models = modelsFromOmpJson(parseJsonOutput(listed.stdout))
      if (!models.length) throw new Error("OMP native model picker did not report any available models")
      this.lastError = null
      return { models, source: "omp-native:models-refresh-json" }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  diagnostics() {
    return { source: "omp-native", commandResolved: Boolean(this.command), lastAttemptAt: this.lastAttemptAt, lastError: this.lastError }
  }
}

function sameBase(left, right) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}

function mergeNativeMembership(nativeModels, acpModels) {
  const nativeBaseKeys = new Set(nativeModels.filter((model) => !model.variant).map((model) => `${model.providerID}|${model.modelID}`))
  const nativeVariantKeys = new Set(nativeModels.filter((model) => model.variant).map((model) => `${model.providerID}|${model.modelID}`))
  const merged = []

  for (const native of nativeModels) {
    if (native.variant) {
      merged.push(native)
      continue
    }
    const metadata = acpModels.find((candidate) => !candidate.variant && sameBase(candidate, native))
    merged.push(metadata ? { ...metadata, ...native, isDefault: metadata.isDefault === true } : native)
  }

  // PI's native table exposes authoritative membership/capabilities but not exact thinking levels.
  // Enrich only models that the native list confirmed. OMP's JSON already carries authoritative
  // thinking efforts, so ACP cannot add alternate variants when native variants are present.
  for (const acp of acpModels) {
    if (!acp.variant) continue
    const key = `${acp.providerID}|${acp.modelID}`
    if (!nativeBaseKeys.has(key) || nativeVariantKeys.has(key)) continue
    merged.push(acp)
  }
  return dedupe(merged)
}

function sameSelection(left, right) {
  return left.providerID === right.providerID && left.modelID === right.modelID && (left.variant || "") === (right.variant || "")
}

export class NativeFilteredAcpModelCatalog {
  constructor({ inner, liveSource, agentID, directory, ttlMs = NATIVE_MODEL_CATALOG_TTL_MS } = {}) {
    this.inner = inner
    this.liveSource = liveSource
    this.agentID = agentID
    this.directory = directory
    this.ttlMs = ttlMs
    this.cache = []
    this.refreshedAt = null
    this.lastAttemptAt = null
    this.lastError = null
    this.metadataError = null
    this.inFlight = null
    this.source = `${agentID}-native-live`
    this.hiddenSessionIDs = inner.hiddenSessionIDs
  }

  #fresh() {
    const refreshed = Date.parse(this.refreshedAt ?? "")
    return this.cache.length > 0 && Number.isFinite(refreshed) && Date.now() - refreshed < this.ttlMs
  }

  #result(stale = false, error) {
    return {
      models: this.cache,
      stale,
      refreshedAt: this.refreshedAt,
      source: this.source,
      ...(error ? { error } : {})
    }
  }

  async #refresh(refreshMetadata) {
    this.lastAttemptAt = new Date().toISOString()
    const live = await this.liveSource.list({ directory: this.directory })
    let acpModels = []
    this.metadataError = null
    try {
      const metadata = await this.inner.list({ allowStale: true, refresh: refreshMetadata })
      acpModels = metadata.models
    } catch (error) {
      this.metadataError = error instanceof Error ? error.message : String(error)
    }
    const models = mergeNativeMembership(live.models, acpModels)
    if (!models.length) throw new Error(`Agent ${this.agentID} native model catalog was empty`)
    this.cache = models
    this.refreshedAt = new Date().toISOString()
    this.source = `${live.source}+acp-metadata`
    this.lastError = null
    return this.#result(false)
  }

  async preloadState() {
    return this.inner.preloadState?.() ?? this.hiddenSessionIDs
  }

  async list({ allowStale = true, refresh = false } = {}) {
    if (!refresh && this.#fresh()) return this.#result(false)
    if (!this.inFlight) {
      let wrapped
      wrapped = this.#refresh(refresh).finally(() => {
        if (this.inFlight === wrapped) this.inFlight = null
      })
      this.inFlight = wrapped
    }
    try {
      return await this.inFlight
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      if (allowStale && this.cache.length) return this.#result(true, this.lastError)
      throw error
    }
  }

  async resolve(model) {
    if (!model) return null
    const result = await this.list({ allowStale: false })
    const selected = result.models.find((candidate) => sameSelection(candidate, model))
    if (selected) return selected
    const suffix = model.variant ? ` (${model.variant})` : ""
    const error = new Error(`Selected model is no longer available: ${model.providerID}/${model.modelID}${suffix}`)
    error.code = "model_unavailable"
    throw error
  }

  async validate(model) { await this.resolve(model) }

  diagnostics() {
    const refreshed = Date.parse(this.refreshedAt ?? "")
    return {
      source: this.source,
      cachedModels: this.cache.length,
      refreshedAt: this.refreshedAt,
      ageMs: Number.isFinite(refreshed) ? Math.max(0, Date.now() - refreshed) : null,
      inFlight: Boolean(this.inFlight),
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError,
      metadataError: this.metadataError,
      ttlMs: this.ttlMs,
      native: this.liveSource.diagnostics?.() ?? null,
      acpMetadata: this.inner.diagnostics?.() ?? null
    }
  }

  close() { this.inner.close?.() }
}
