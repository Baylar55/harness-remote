import { spawn } from "node:child_process"
import { findExecutable } from "./launcher.js"

const DEFAULT_REFRESH_TIMEOUT_MS = 20_000
const MAX_CAPTURE_BYTES = 32_000

function appendCapture(current, chunk) {
  const next = current + String(chunk ?? "")
  return next.length <= MAX_CAPTURE_BYTES ? next : next.slice(-MAX_CAPTURE_BYTES)
}

export function nativeModelRefreshSpec(backend, { find = findExecutable } = {}) {
  if (backend === "pi") {
    return {
      backend,
      label: "PI",
      command: find("pi"),
      args: ["update", "--models"]
    }
  }
  if (backend === "omp") {
    return {
      backend,
      label: "Oh My Pi",
      command: find("omp"),
      args: ["models", "refresh", "--json"]
    }
  }
  return null
}

export function runNativeModelRefresh({
  command,
  args = [],
  directory,
  label = command || "native harness",
  timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
  spawnImpl = spawn,
  environment = process.env
}) {
  if (!command) {
    const error = new Error(`${label} executable was not found on PATH; live model refresh is unavailable`)
    error.code = "model_refresh_executable_missing"
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let timer
    let child

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }

    try {
      child = spawnImpl(command, args, {
        cwd: directory,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    } catch (error) {
      finish(error)
      return
    }

    child.stdout?.on?.("data", (chunk) => { stdout = appendCapture(stdout, chunk) })
    child.stderr?.on?.("data", (chunk) => { stderr = appendCapture(stderr, chunk) })
    child.once?.("error", (error) => finish(error))
    child.once?.("exit", (code, signal) => {
      if (code === 0) {
        finish(null, { stdout, stderr })
        return
      }
      const detail = stderr.trim() || stdout.trim()
      const suffix = detail ? `: ${detail}` : signal ? ` (${signal})` : ""
      const error = new Error(`${label} model refresh failed with exit code ${code ?? "unknown"}${suffix}`)
      error.code = "model_refresh_failed"
      finish(error)
    })

    timer = setTimeout(() => {
      child.kill?.("SIGTERM")
      const error = new Error(`${label} model refresh timed out after ${timeoutMs}ms`)
      error.code = "model_refresh_timeout"
      finish(error)
    }, Math.max(1, timeoutMs))
  })
}

export function withNativeModelRefresh(agent, {
  backend,
  directory,
  find = findExecutable,
  spawnImpl = spawn,
  environment = process.env,
  refreshTimeoutMs = DEFAULT_REFRESH_TIMEOUT_MS
} = {}) {
  const spec = nativeModelRefreshSpec(backend, { find })
  if (!spec) return agent

  let inFlight = null
  let lastAttemptAt = null
  let refreshedAt = null
  let lastError = null

  const refresh = (timeoutMs) => {
    if (!inFlight) {
      lastAttemptAt = new Date().toISOString()
      const operation = runNativeModelRefresh({
        ...spec,
        directory,
        timeoutMs: Math.max(1, Math.min(refreshTimeoutMs, timeoutMs)),
        spawnImpl,
        environment
      }).then((result) => {
        refreshedAt = new Date().toISOString()
        lastError = null
        return result
      }).catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
        throw error
      })
      let wrapped
      wrapped = operation.finally(() => {
        if (inFlight === wrapped) inFlight = null
      })
      inFlight = wrapped
    }
    return inFlight
  }

  return {
    get processID() { return agent.processID },
    on: (...args) => agent.on?.(...args),
    off: (...args) => agent.off?.(...args),
    request: (...args) => agent.request(...args),
    close: (...args) => agent.close?.(...args),
    async start(timeoutMs) {
      const budget = Number.isFinite(timeoutMs) ? Math.max(1, Number(timeoutMs)) : 90_000
      const deadline = Date.now() + budget
      await refresh(budget)
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        const error = new Error(`${spec.label} model discovery exhausted its startup budget during native catalog refresh`)
        error.code = "model_catalog_timeout"
        throw error
      }
      return agent.start(remaining)
    },
    diagnostics() {
      return {
        ...(agent.diagnostics?.() ?? { processID: agent.processID }),
        nativeModelRefresh: {
          backend: spec.backend,
          command: spec.command,
          args: spec.args,
          directory,
          inFlight: Boolean(inFlight),
          lastAttemptAt,
          refreshedAt,
          lastError
        }
      }
    }
  }
}
