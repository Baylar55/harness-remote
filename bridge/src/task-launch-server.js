import http from "node:http"
import { authenticateDaemonRequest, writeJSON } from "./http-policy.js"

const TASK_LAUNCH_ROUTE = /^\/v1\/tasks\/([^/]+)\/launch$/
const TASK_CONTINUE_ROUTE = /^\/v1\/tasks\/([^/]+)\/continue$/
const TASK_WORKTREE_ROUTE = /^\/v1\/tasks\/([^/]+)\/worktree$/
const TASK_WORKTREE_CLEANUP_ROUTE = /^\/v1\/tasks\/([^/]+)\/worktree\/cleanup$/
const LAUNCH_STATUS = new Map([
  ["unknown_task", 404],
  ["unknown_agent", 404],
  ["agent_unavailable", 503],
  ["invalid_state", 409],
  ["workspace_required", 409],
  ["unsupported_agent", 409],
  ["task_active", 409],
  ["worktree_dirty", 409],
  ["invalid_worktree", 409],
  ["worktree_outside_state", 409],
  ["worktree_missing", 409]
])

async function readJSONBody(request) {
  let body = ""
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error("Request body is too large")
  }
  return body ? JSON.parse(body) : {}
}

export function launchStatus(error) {
  return LAUNCH_STATUS.get(error?.code) ?? 500
}

export function createTaskLaunchServer({ innerServer, config, taskRunController, createServer = http.createServer }) {
  return createServer(async (request, response) => {
    const requestURL = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    const launchMatch = TASK_LAUNCH_ROUTE.exec(requestURL.pathname)
    const continueMatch = TASK_CONTINUE_ROUTE.exec(requestURL.pathname)
    const worktreeMatch = TASK_WORKTREE_ROUTE.exec(requestURL.pathname)
    const cleanupMatch = TASK_WORKTREE_CLEANUP_ROUTE.exec(requestURL.pathname)
    const inspect = worktreeMatch && request.method === "GET"
    const cleanup = cleanupMatch && request.method === "POST"
    if (!launchMatch && !continueMatch && !inspect && !cleanup) {
      innerServer.emit("request", request, response)
      return
    }

    if (!authenticateDaemonRequest(request, response, config)) return
    try {
      if (launchMatch || continueMatch) {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST, OPTIONS" })
          response.end()
          return
        }
        const taskID = decodeURIComponent((launchMatch ?? continueMatch)[1])
        if (continueMatch) {
          const body = await readJSONBody(request)
          writeJSON(response, 200, await taskRunController.continue(taskID, body.prompt))
        } else {
          writeJSON(response, 200, await taskRunController.launch(taskID))
        }
        return
      }
      if (inspect) {
        writeJSON(response, 200, await taskRunController.inspectWorkspace(decodeURIComponent(worktreeMatch[1])))
        return
      }
      writeJSON(response, 200, await taskRunController.cleanupWorkspace(decodeURIComponent(cleanupMatch[1])))
    } catch (error) {
      writeJSON(response, launchStatus(error), {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: error.code } : {})
      })
    }
  })
}
