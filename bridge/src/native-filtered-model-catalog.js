import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DEFAULT_NATIVE_MODEL_TIMEOUT_MS = 20_000
const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/g

function modelKey(model) {
  return `${model.providerID}/${model.modelID}`
}

function sameModel(left, right) {
  return left.providerID === right.providerID && left.modelID === right.modelID && (left.variant ?? "") === (right.variant ?? "")
}

/**
 * Parse the table emitted by PI/OMP `--list-models` without depending on column widths.
 * The native CLIs print concrete provider rows as `<provider> <model> ...`. Some versions also
 * print canonical rows where the first token is already `provider/model`; keep both forms and let
 * the intersection with ACP candidates decide what is actually relevant.
 */
export function modelKeysFromNativeList(output) {
  const keys = new Set()
  for (const rawLine of String(output ?? "").replace(ANSI_ESCAPE, "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const columns = line.split(/\s+/)
    if (!columns.length) continue
    const first = columns[0]
    const second = columns[1]
    if (/^(provider|canonical|model)$/i.test(first) && /^(model|id|selector)$/i.test(second ?? "")) continue
    if (/^[-=─━]+$/.test(first)) continue
    if (first.includes("/")) keys.add(first)
    if (second && !/^[-=─━]+$/.test(second)) keys.add(`${first}/${second}`)
  }
  return keys
}

/**
 * ACP remains responsible for metadata and model-specific config options. Membership comes from
 * the installed harness itself, so a stale ACP adapter cannot make Harness Remote offer a model
 * that the native PI/OMP picker no longer exposes.
 */
export class NativeFilteredModelCatalog {
  constructor({
    catalog,
    command,
    args = ["--list-models"],
    cwd,
    timeoutMs = DEFAULT_NATIVE_MODEL_TIMEOUT_MS,
    execFileImpl = execFileAsync
  }) {
    this.catalog = catalog
    this.command = command
    this.args = [...args]
    this.cwd = cwd
    this.timeoutMs = timeoutMs
    this.execFileImpl = execFileImpl
    this.lastAttemptAt = null
    this.lastSuccessAt = null
    this.lastError = null
    this.lastNativeModels = 0
  }

  get hiddenSessionIDs() { return this.catalog.hiddenSessionIDs }

  preloadState() { return this.catalog.preloadState?.() ?? this.hiddenSessionIDs }

  async #nativeKeys() {
    this.lastAttemptAt = new Date().toISOString()
    try {
      const result = await this.execFileImpl(this.command, this.args, {
        cwd: this.cwd,
        timeout: this.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8"
      })
      const stdout = typeof result === "string" ? result : result?.stdout
      const keys = modelKeysFromNativeList(stdout)
      if (!keys.size) {
        const error = new Error(`${this.command} --list-models returned no parseable models`)
        error.code = "native_model_catalog_empty"
        throw error
      }
      this.lastNativeModels = keys.size
      this.lastSuccessAt = new Date().toISOString()
      this.lastError = null
      return keys
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      if (!error?.code) error.code = "native_model_catalog_unavailable"
      throw error
    }
  }

  async list(options = {}) {
    const base = await this.catalog.list(options)
    const allowed = await this.#nativeKeys()
    const models = base.models.filter((model) => allowed.has(modelKey(model)))
    if (!models.length && base.models.length) {
      const error = new Error(`Native ${this.command} model catalog did not match any ACP-advertised model`)
      error.code = "native_model_catalog_mismatch"
      this.lastError = error.message
      throw error
    }
    return {
      ...base,
      models,
      source: `${this.catalog.diagnostics?.().source ?? "acp"}+native:${this.command}`
    }
  }

  async resolve(model) {
    if (!model) return null
    const result = await this.list({ allowStale: false })
    const candidate = result.models.find((item) => sameModel(item, model))
    if (candidate) return candidate
    const suffix = model.variant ? ` (${model.variant})` : ""
    const error = new Error(`Selected model is no longer available: ${model.providerID}/${model.modelID}${suffix}`)
    error.code = "model_unavailable"
    throw error
  }

  async validate(model) { await this.resolve(model) }

  diagnostics() {
    const base = this.catalog.diagnostics?.() ?? {}
    return {
      ...base,
      source: `${base.source ?? "acp"}+native:${this.command}`,
      nativeFilter: {
        command: this.command,
        args: [...this.args],
        lastAttemptAt: this.lastAttemptAt,
        lastSuccessAt: this.lastSuccessAt,
        lastError: this.lastError,
        lastNativeModels: this.lastNativeModels
      }
    }
  }

  close() { this.catalog.close?.() }
}
