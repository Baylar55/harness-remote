import http from "node:http"
import { authenticateDaemonRequest, writeJSON } from "./http-policy.js"

const SESSION_CLAIM_ROUTE = /^\/v1\/agents\/([^/]+)\/session\/([^/]+)\/claim$/

function statusForClaimError(error) {
  if (error?.code === "unknown_agent") return 404
  if (error?.code === "unsupported_agent") return 409
  if (error?.code === "session_unavailable") return 409
  // Native harness writer-lock errors are intentionally surfaced as conflicts rather than generic
  // server failures: the Session still exists and remains observable, HR simply cannot own it now.
  if (/session|load|writer|locked|busy|owned|active/i.test(error instanceof Error ? error.message : String(error))) return 409
  return 500
}

/**
 * Machine-daemon boundary for explicitly acquiring the writer of one existing native Session.
 *
 * This route is intentionally separate from model discovery and from the Task/Run compatibility
 * stack. It never creates a Session. A native single-writer refusal is returned to the caller so
 * the UI can remain in observe-only mode and retry later.
 */
export function createSessionClaimServer({ innerServer, config, claimSession, createServer = http.createServer }) {
  return createServer(async (request, response) => {
    const requestURL = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    const match = SESSION_CLAIM_ROUTE.exec(requestURL.pathname)
    if (!match) {
      innerServer.emit("request", request, response)
      return
    }

    if (!authenticateDaemonRequest(request, response, config)) return
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST, OPTIONS" })
      response.end()
      return
    }

    try {
      const agentID = decodeURIComponent(match[1])
      const sessionID = decodeURIComponent(match[2])
      await claimSession(agentID, sessionID)
      writeJSON(response, 200, { claimed: true, sessionID })
    } catch (error) {
      writeJSON(response, statusForClaimError(error), {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: error.code } : {})
      })
    }
  })
}
