import http from "node:http"
import { allowedOrigin, applyCorsHeaders, matchesCredentials, writeJSON } from "./http-policy.js"

const MODEL_ROUTE = /^\/v1\/agents\/([^/]+)\/models$/
const TASK_LAUNCH_ROUTE = /^\/v1\/tasks\/([^/]+)\/launch$/
const DEFAULT_MODEL_WAIT_MS = 4_000
const MAX_MODEL_WAIT_MS = 8_000

function authenticate(request, response, config) {
  applyCorsHeaders(request, response, config)
  if (request.method === "OPTIONS") {
    response.writeHead(allowedOrigin(request, config) ? 204 : 403)
    response.end()
    return false
  }
  if (!matchesCredentials(request, config)) {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Harness Remote Daemon"' })
    response.end()
    return false
  }
  return true
}

function modelWaitMs(url) {
  const raw = url.searchParams.get("waitMs")
  if (raw === null || raw === "") return DEFAULT_MODEL_WAIT_MS
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_MODEL_WAIT_MS
  return Math.max(0, Math.min(MAX_MODEL_WAIT_MS, Math.trunc(value)))
}

async function settleWithin(promise, waitMs) {
  if (waitMs <= 0) return { settled: false }
  let timer
  const pending = Symbol("pending")
  try {
    const result = await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(pending), waitMs) })
    ])
    return result === pending ? { settled: false } : { settled: true, result }
  } catch (error) {
    return { settled: true, error }
  } finally {
    clearTimeout(timer)
  }
}

function requestError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function modelDirectory(url, { taskStore, projectCatalog }) {
  const projectID = url.searchParams.get("projectId")?.trim() || ""
  const workThreadID = url.searchParams.get("workThreadId")?.trim() || ""
  if (projectID && workThreadID) throw requestError(400, "Model discovery accepts either projectId or workThreadId, not both")

  if (workThreadID) {
    if (typeof taskStore?.get !== "function") throw requestError(503, "Conversation model scope is unavailable")
    const task = await taskStore.get(workThreadID)
    if (!task) throw requestError(404, `Unknown conversation: ${workThreadID}`)
    const directory = task.workspace?.path || task.project?.path
    if (!directory) throw requestError(409, "Conversation workspace is not prepared")
    return directory
  }

  if (projectID) {
    if (typeof projectCatalog !== "function") throw requestError(503, "Project model scope is unavailable")
    const projects = await projectCatalog()
    const project = Array.isArray(projects) ? projects.find((candidate) => candidate?.id === projectID) : undefined
    if (!project?.path) throw requestError(404, `Unknown project: ${projectID}`)
    return project.path
  }

  return undefined
}

export function createAgentModelServer({ innerServer, config, daemon, taskStore, projectCatalog, createServer = http.createServer }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    const modelMatch = MODEL_ROUTE.exec(url.pathname)
    if (modelMatch) {
      if (!authenticate(request, response, config)) return
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET, OPTIONS" })
        response.end()
        return
      }
      const agentID = decodeURIComponent(modelMatch[1])
      const refresh = url.searchParams.get("refresh") === "1"
      let directory
      try {
        directory = await modelDirectory(url, { taskStore, projectCatalog })
      } catch (error) {
        writeJSON(response, Number(error?.status) || 400, { error: error instanceof Error ? error.message : String(error), models: [], stale: true })
        return
      }
      const options = { allowStale: true, refresh, ...(directory ? { directory } : {}) }
      const discovery = daemon.listModels(agentID, options)
      const settled = await settleWithin(discovery, modelWaitMs(url))
      if (!settled.settled) {
        // The discovery remains owned by the daemon/catalog and continues after this response. A
        // mobile/browser request is therefore never required to survive a cold `npx` adapter start.
        // Subsequent polls join the same single-flight operation for the same Project scope instead
        // of starting another technical Session.
        const diagnostics = daemon.modelDiagnostics?.(agentID, directory ? { directory } : undefined) ?? {}
        response.setHeader("Retry-After", "1")
        writeJSON(response, 202, {
          models: [],
          stale: false,
          refreshedAt: diagnostics.refreshedAt ?? null,
          loading: true,
          source: diagnostics.source,
          lastError: diagnostics.lastError ?? undefined
        })
        return
      }
      if (settled.error) {
        writeJSON(response, 503, { error: settled.error instanceof Error ? settled.error.message : String(settled.error), models: [], stale: true })
        return
      }
      writeJSON(response, 200, settled.result)
      return
    }

    const launchMatch = TASK_LAUNCH_ROUTE.exec(url.pathname)
    if (launchMatch && request.method === "POST") {
      if (!authenticate(request, response, config)) return
      const taskID = decodeURIComponent(launchMatch[1])
      try {
        const task = await taskStore.get(taskID)
        if (!task) {
          writeJSON(response, 404, { error: `Unknown task: ${taskID}` })
          return
        }
        if (task.model) {
          const options = task.workspace?.path ? { directory: task.workspace.path } : undefined
          await daemon.validateModel(task.agentId, task.model, options)
        }
      } catch (error) {
        const status = error?.code === "model_unavailable" ? 409 : 503
        writeJSON(response, status, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      innerServer.emit("request", request, response)
      return
    }

    innerServer.emit("request", request, response)
  })
}
