import { createHash } from "node:crypto"
import http from "node:http"
import { authenticateDaemonRequest, writeJSON } from "./http-policy.js"

const SESSION_OPERATION_ROUTE = /^\/v1\/agents\/([^/]+)\/session\/([^/]+)\/(claim|prompt)$/

function requestError(message) {
  const error = new Error(message)
  error.code = "invalid_request"
  return error
}

function statusForSessionError(error) {
  if (error?.code === "invalid_request") return 400
  if (error?.code === "unknown_agent") return 404
  if (["unsupported_agent", "session_unavailable", "idempotency_conflict"].includes(error?.code)) return 409
  // Native harness writer-lock errors are intentionally surfaced as conflicts rather than generic
  // server failures: the Session still exists and remains observable, HR simply cannot own it now.
  if (/session|load|writer|locked|busy|owned|active/i.test(error instanceof Error ? error.message : String(error))) return 409
  return 500
}

async function readJSONBody(request) {
  let body = ""
  for await (const chunk of request) {
    body += chunk
    if (body.length > 2_000_000) throw requestError("Request body is too large")
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    throw requestError("Request body must be valid JSON")
  }
}

function promptInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw requestError("Request body must be a JSON object")
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : ""
  const text = typeof body.text === "string" ? body.text.trim() : ""
  const directory = typeof body.directory === "string" ? body.directory : ""
  if (!clientRequestId || clientRequestId.length > 200) throw requestError("A valid clientRequestId is required")
  if (!text) throw requestError("A text prompt is required")
  return { clientRequestId, text, directory }
}

function promptSignature({ text, directory }) {
  return createHash("sha256").update(JSON.stringify({ text, directory })).digest("hex")
}

/**
 * Machine-daemon boundary for native Session ownership and idempotent prompt submission.
 *
 * Neither operation creates a Session or touches the Task/Run compatibility stack. Prompt ids are
 * persisted before dispatch; a duplicate accepted id returns success without dispatching again. A
 * pending/uncertain id is never replayed automatically after a crash or ambiguous local transport
 * failure because duplicate coding work is worse than asking the client to reconcile the transcript.
 */
export function createSessionClaimServer({
  innerServer,
  config,
  claimSession,
  promptSession,
  operationLedger,
  createServer = http.createServer
}) {
  return createServer(async (request, response) => {
    const requestURL = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
    const match = SESSION_OPERATION_ROUTE.exec(requestURL.pathname)
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

    const agentID = decodeURIComponent(match[1])
    const sessionID = decodeURIComponent(match[2])
    const operation = match[3]
    try {
      if (operation === "claim") {
        await claimSession(agentID, sessionID)
        writeJSON(response, 200, { claimed: true, sessionID })
        return
      }

      if (!operationLedger || typeof promptSession !== "function") throw new Error("Native Session prompt transport is not configured")
      const input = promptInput(await readJSONBody(request))
      const identity = { agentID, sessionID, clientRequestId: input.clientRequestId }
      const started = await operationLedger.begin({
        ...identity,
        signature: promptSignature(input)
      })
      if (started.duplicate) {
        const status = started.state === "accepted" ? 200 : 202
        writeJSON(response, status, { status: started.state, clientRequestId: input.clientRequestId, sessionID })
        return
      }

      let dispatched = false
      try {
        await promptSession(agentID, sessionID, input)
        dispatched = true
        await operationLedger.accept(identity)
        writeJSON(response, 200, { status: "accepted", clientRequestId: input.clientRequestId, sessionID })
      } catch (error) {
        const ambiguous = dispatched || error?.ambiguous === true
        await operationLedger.fail({ ...identity, ambiguous })
        if (ambiguous) {
          writeJSON(response, 202, { status: "uncertain", clientRequestId: input.clientRequestId, sessionID })
          return
        }
        throw error
      }
    } catch (error) {
      writeJSON(response, statusForSessionError(error), {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: error.code } : {})
      })
    }
  })
}
