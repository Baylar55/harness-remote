import assert from "node:assert/strict"
import http from "node:http"
import { spawn } from "node:child_process"
import { chromium } from "playwright"

const PREVIEW_PORT = 4175
const DAEMON_PORT = 4421
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const SESSION_ID = "native-pi-v3-first-1"
const DIRECTORY = "/work/native-pi-v3-first"
const SUCCESS_PROMPT = "PI-SUCCESS-PROMPT"
const SUCCESS_REPLY = "PI-SINGLE-FINAL-REPLY"
const ERROR_PROMPT = "PI-ERROR-PROMPT"
const LOST_PROMPT = "PI-LOST-HTTP-PROMPT"
const LOST_REPLY = "PI-LOST-HTTP-REPLY"

function textPart(id, text) {
  return { id, type: "text", text }
}

function message(id, role, parts, created, error) {
  return {
    info: { id, role, sessionID: SESSION_ID, time: { created }, ...(error ? { error } : {}) },
    parts
  }
}

function initialTranscript() {
  return [
    message("pi-history-user-1", "user", [textPart("pi-history-user-text-1", "PI-HISTORY-USER-1")], 1_000),
    message("pi-history-assistant-1", "assistant", [textPart("pi-history-assistant-text-1", "PI-HISTORY-ASSISTANT-1")], 1_001),
    message("pi-history-user-2", "user", [textPart("pi-history-user-text-2", "PI-HISTORY-USER-2")], 1_002),
    message("pi-history-assistant-2", "assistant", [textPart("pi-history-assistant-text-2", "PI-HISTORY-ASSISTANT-2")], 1_003)
  ]
}

let claimed
let messages
let claimCount
let modelCatalogReads
let promptHttpBodies
let nativePromptDispatches
let uncertainDelivered
let ledger
let clock

function resetFakeState() {
  claimed = false
  messages = initialTranscript()
  claimCount = 0
  modelCatalogReads = 0
  promptHttpBodies = []
  nativePromptDispatches = 0
  uncertainDelivered = false
  ledger = new Map()
  clock = 10_000
}

function appendSuccessTurn(prompt, requestId, reply = SUCCESS_REPLY) {
  const base = clock
  clock += 20
  messages.push(
    message(`pi-user-${requestId}`, "user", [textPart(`pi-user-text-${requestId}`, prompt)], base),
    message(`pi-assistant-reason-${requestId}`, "assistant", [{ id: `pi-reason-${requestId}`, type: "reasoning", text: "PI reasoning marker" }], base + 1),
    message(`pi-assistant-note-${requestId}`, "assistant", [textPart(`pi-note-${requestId}`, "PI working note before tool")], base + 2),
    message(`pi-assistant-tool-start-${requestId}`, "assistant", [{
      id: `pi-tool-start-${requestId}`,
      type: "tool",
      tool: "shell",
      callID: `pi-call-${requestId}`,
      state: { status: "running", title: "PI tool", input: { command: "printf pi" } }
    }], base + 3),
    message(`pi-assistant-tool-finish-${requestId}`, "assistant", [{
      id: `pi-tool-finish-${requestId}`,
      type: "tool",
      tool: "shell",
      callID: `pi-call-${requestId}`,
      state: { status: "completed", title: "PI tool", input: { command: "printf pi" }, output: "PI tool completed" }
    }], base + 4),
    message(`pi-assistant-final-${requestId}`, "assistant", [textPart(`pi-final-${requestId}`, reply)], base + 5)
  )
}

function appendErrorTurn(prompt, requestId) {
  const base = clock
  clock += 20
  messages.push(
    message(`pi-error-user-${requestId}`, "user", [textPart(`pi-error-user-text-${requestId}`, prompt)], base),
    message(`pi-error-assistant-${requestId}`, "assistant", [], base + 1, {
      name: "PIError",
      message: "PI synthetic failure",
      data: { message: "PI synthetic failure" }
    })
  )
}

const MODEL_CATALOG = {
  models: [
    {
      providerID: "pi",
      providerName: "PI",
      modelID: "pi-coding",
      modelName: "PI Coding",
      description: "PI coding model",
      isDefault: true,
      tools: true,
      contextLimit: 200000,
      outputLimit: 64000
    },
    {
      providerID: "pi",
      providerName: "PI",
      modelID: "pi-coding",
      modelName: "PI Coding",
      description: "PI coding model high effort",
      variant: "high",
      tools: true,
      contextLimit: 200000,
      outputLimit: 64000
    }
  ],
  stale: false,
  refreshedAt: new Date().toISOString(),
  source: "native-pi-v3-first-smoke"
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Harness-Backend",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600"
  }
}

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(), ...extraHeaders })
  response.end(JSON.stringify(value))
}

async function requestJSON(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw ? JSON.parse(raw) : null
}

function startFakeDaemon() {
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }

    const url = new URL(request.url || "/", `http://127.0.0.1:${DAEMON_PORT}`)

    if (request.method === "GET" && url.pathname === "/v1/machine") {
      json(response, 200, {
        machine: { id: "machine-pi-v3-first", name: "PI v3-first Test", createdAt: new Date().toISOString() },
        agents: [{
          id: "pi",
          label: "PI",
          backend: "pi",
          transport: "acp",
          managed: true,
          state: "available",
          capabilities: { sessions: true, prompt: true, abort: true, streaming: true, models: true },
          contract: { sessions: { stop: "owned-session-native-cancel" } }
        }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/projects") {
      json(response, 200, {
        projects: [{ id: "project-pi-v3-first", machineId: "machine-pi-v3-first", name: "native-pi-v3-first", path: DIRECTORY, kind: "git", configured: true }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/experimental/session") {
      json(response, 200, [{
        id: SESSION_ID,
        title: "PI v3-first regression session",
        directory: DIRECTORY,
        external: true,
        writerOwned: claimed,
        time: { created: 1_000, updated: clock }
      }])
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/session/status") {
      json(response, 200, { [SESSION_ID]: { type: "idle" } })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/models") {
      modelCatalogReads += 1
      json(response, 200, MODEL_CATALOG)
      return
    }

    if (request.method === "GET" && url.pathname === `/v1/agents/pi/session/${SESSION_ID}/message`) {
      json(response, 200, messages, { "X-Has-More": "0" })
      return
    }

    if (request.method === "POST" && url.pathname === `/v1/agents/pi/session/${SESSION_ID}/claim`) {
      claimCount += 1
      claimed = true
      json(response, 200, { ok: true })
      return
    }

    if (request.method === "POST" && url.pathname === `/v1/agents/pi/session/${SESSION_ID}/prompt`) {
      const body = await requestJSON(request)
      promptHttpBodies.push(body)
      const requestId = body?.clientRequestId
      if (!requestId) {
        json(response, 400, { error: "missing clientRequestId" })
        return
      }

      if (!ledger.has(requestId)) {
        nativePromptDispatches += 1
        ledger.set(requestId, body)
        if (body.text === ERROR_PROMPT) appendErrorTurn(body.text, requestId)
        else if (body.text === LOST_PROMPT) appendSuccessTurn(body.text, requestId, LOST_REPLY)
        else appendSuccessTurn(body.text, requestId)
      }

      if (body.text === LOST_PROMPT && !uncertainDelivered) {
        uncertainDelivered = true
        json(response, 202, { status: "uncertain", clientRequestId: requestId })
        return
      }

      json(response, 200, { status: "accepted", clientRequestId: requestId })
      return
    }

    if (request.method === "POST" && url.pathname === `/v1/agents/pi/session/${SESSION_ID}/stop`) {
      json(response, 200, { status: "accepted" })
      return
    }

    if (request.method === "GET" && (url.pathname.includes("/question") || url.pathname.includes("/permission"))) {
      json(response, 200, [])
      return
    }

    if (request.method === "GET" && url.pathname.includes("/global/event")) {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }

    json(response, 404, { error: `No fake route for ${request.method} ${url.pathname}` })
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(DAEMON_PORT, "127.0.0.1", () => resolve(server))
  })
}

function startPreview() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm"
  return spawn(command, ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  })
}

async function ready(url) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw lastError || new Error(`Preview did not become ready: ${url}`)
}

function stopPreview(child) {
  if (!child || child.killed || !child.pid) return
  try {
    if (process.platform === "win32") child.kill("SIGTERM")
    else process.kill(-child.pid, "SIGTERM")
  } catch {
    try { child.kill("SIGTERM") } catch {}
  }
}

function stopServer(server) {
  try { server.closeAllConnections?.() } catch {}
  try { server.close() } catch {}
}

async function seed(page) {
  await page.addInitScript(({ key, port }) => {
    localStorage.setItem(key, JSON.stringify([{
      id: "machine-pi-v3-first",
      name: "PI v3-first Test",
      config: { backend: "opencode", host: "127.0.0.1", port, username: "harness", password: "testpw" }
    }]))
  }, { key: STORAGE_KEY, port: DAEMON_PORT })
}

async function waitFor(predicate, description, timeout = 12_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function waitForReady(page) {
  await page.locator(".tdw-conversation-state.ready").waitFor({ state: "visible", timeout: 12_000 })
  const send = page.getByRole("button", { name: "Send" })
  await send.waitFor({ state: "visible", timeout: 12_000 })
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (!(await send.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Timed out waiting for enabled v3 Send control")
}

async function openSession(page, expectClaim) {
  await page.locator('.hr-native-workspace[aria-label="Sessions"]').waitFor({ state: "visible" })
  await page.getByRole("button", { name: /PI v3-first regression session/ }).click()
  await page.locator(".hr-native-session-observer").waitFor({ state: "visible" })
  if (expectClaim) {
    await page.getByRole("button", { name: "Continue this Session" }).waitFor({ state: "visible" })
  } else {
    await page.locator(".tdw-work-thread-conversation").waitFor({ state: "visible" })
    await page.locator(".uw-composer-shell").waitFor({ state: "visible" })
  }
}

async function sendPrompt(page, text) {
  const composer = page.getByRole("textbox", { name: "Message PI" })
  await composer.fill(text)
  await page.getByRole("button", { name: "Send" }).click()
}

async function assertSessionContract(browser, viewport, mobile) {
  resetFakeState()
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })

  if (mobile) {
    await page.locator('.hr-mobile-nav button[aria-current="page"]').filter({ hasText: "Sessions" }).waitFor({ state: "visible" })
  }

  await openSession(page, true)
  assert.equal(await page.locator(".uw-composer-shell").count(), 0, "external PI ACP Session must stay observe-only before explicit ownership")
  assert.equal(claimCount, 0, "opening the Session must not claim it")
  assert.equal(modelCatalogReads, 0, "read-only Session shell must not mount a second model controller")

  await page.getByRole("button", { name: "Continue this Session" }).click()
  await page.locator(".tdw-work-thread-conversation").waitFor({ state: "visible" })
  await page.locator(".uw-composer-shell").waitFor({ state: "visible" })
  assert.equal(claimCount, 1, "one Continue click must claim the exact PI Session once")
  assert.ok(modelCatalogReads > 0, "the mature v3 controller must load the PI model catalog after ownership")

  for (const marker of ["PI-HISTORY-USER-1", "PI-HISTORY-ASSISTANT-1", "PI-HISTORY-USER-2", "PI-HISTORY-ASSISTANT-2"]) {
    assert.equal(await page.getByText(marker, { exact: true }).count(), 1, `historical PI marker duplicated: ${marker}`)
  }
  const historyOrder = await page.locator(".uw-transcript").evaluate((element) => {
    const text = element.textContent || ""
    return ["PI-HISTORY-USER-1", "PI-HISTORY-ASSISTANT-1", "PI-HISTORY-USER-2", "PI-HISTORY-ASSISTANT-2"].map((value) => text.indexOf(value))
  })
  assert.ok(historyOrder.every((value) => value >= 0) && historyOrder.every((value, index) => index === 0 || historyOrder[index - 1] < value), `PI history order regressed: ${historyOrder.join(",")}`)

  await page.locator(".tdw-model-trigger").click()
  await page.getByRole("listbox", { name: "Models" }).waitFor({ state: "visible" })
  await page.getByRole("button", { name: "high", exact: true }).click()

  const httpBefore = promptHttpBodies.length
  const dispatchBefore = nativePromptDispatches
  await sendPrompt(page, SUCCESS_PROMPT)
  await waitFor(() => promptHttpBodies.length >= httpBefore + 1, "PI success HTTP attempt")
  assert.equal(promptHttpBodies.length, httpBefore + 1, "one PI Send click must create one prompt HTTP operation")
  assert.equal(nativePromptDispatches, dispatchBefore + 1, "one PI Send click must dispatch one native session/prompt")
  const firstBody = promptHttpBodies[httpBefore]
  assert.equal(firstBody.text, SUCCESS_PROMPT)
  assert.deepEqual(firstBody.model, { providerID: "pi", modelID: "pi-coding" })
  assert.equal(firstBody.variant, "high")
  assert.equal(typeof firstBody.clientRequestId, "string")

  await page.getByText(SUCCESS_REPLY, { exact: true }).waitFor({ state: "visible", timeout: 15_000 })
  assert.equal(await page.getByText(SUCCESS_PROMPT, { exact: true }).count(), 1, "PI success prompt duplicated")
  assert.equal(await page.getByText(SUCCESS_REPLY, { exact: true }).count(), 1, "PI final answer duplicated")

  const activity = page.locator(".uw-activity-group").last()
  await activity.locator("summary").click()
  await page.getByText("PI reasoning marker", { exact: true }).waitFor({ state: "visible" })
  assert.equal(await page.getByText("PI reasoning marker", { exact: true }).count(), 1, "PI reasoning duplicated")
  assert.equal(await activity.locator(".uw-tool-card").count(), 1, "PI tool updates with different message ids must converge by call identity")
  assert.equal(await page.getByText("PI working note before tool", { exact: true }).count(), 1, "PI working note duplicated")

  const ordered = await page.locator(".uw-transcript").evaluate((element) => {
    const text = element.textContent || ""
    return ["PI-SUCCESS-PROMPT", "PI reasoning marker", "PI working note before tool", "PI tool", "PI-SINGLE-FINAL-REPLY"].map((value) => text.indexOf(value))
  })
  assert.ok(ordered.every((value) => value >= 0) && ordered.every((value, index) => index === 0 || ordered[index - 1] <= value), `PI activity order regressed: ${ordered.join(",")}`)

  await waitForReady(page)
  await sendPrompt(page, ERROR_PROMPT)
  await waitFor(() => nativePromptDispatches >= dispatchBefore + 2, "PI error native dispatch")
  assert.equal(nativePromptDispatches, dispatchBefore + 2, "PI error Send dispatched more than once")
  await page.getByText("PI synthetic failure", { exact: true }).waitFor({ state: "visible", timeout: 15_000 })
  assert.equal(await page.getByText(ERROR_PROMPT, { exact: true }).count(), 1, "PI error prompt duplicated")
  assert.equal(await page.getByText("PI synthetic failure", { exact: true }).count(), 1, "PI provider error duplicated")

  await waitForReady(page)
  const lostHttpBefore = promptHttpBodies.length
  const lostDispatchBefore = nativePromptDispatches
  await sendPrompt(page, LOST_PROMPT)
  await waitFor(() => promptHttpBodies.length >= lostHttpBefore + 1, "PI uncertain-delivery HTTP attempt")
  assert.equal(promptHttpBodies.length, lostHttpBefore + 1, "first uncertain-delivery Send must create one HTTP attempt")
  assert.equal(nativePromptDispatches, lostDispatchBefore + 1, "uncertain delivery must correspond to exactly one native PI dispatch")
  await page.getByText(/Prompt delivery is uncertain/).waitFor({ state: "visible", timeout: 10_000 })
  assert.equal(await page.getByRole("textbox", { name: "Message PI" }).inputValue(), LOST_PROMPT, "uncertain prompt must be restored for explicit reconciliation")

  await page.getByRole("button", { name: "Send" }).click()
  await waitFor(() => promptHttpBodies.length >= lostHttpBefore + 2, "PI reconciliation retry")
  assert.equal(promptHttpBodies.length, lostHttpBefore + 2, "explicit reconciliation must issue exactly one retry HTTP attempt")
  assert.equal(nativePromptDispatches, lostDispatchBefore + 1, "retry must not dispatch native PI work twice")
  assert.equal(promptHttpBodies[lostHttpBefore].clientRequestId, promptHttpBodies[lostHttpBefore + 1].clientRequestId, "retry must reuse the same durable request id")
  await page.getByText(LOST_REPLY, { exact: true }).waitFor({ state: "visible", timeout: 15_000 })
  assert.equal(await page.getByText(LOST_PROMPT, { exact: true }).count(), 1, "reconciliation duplicated the user prompt")
  assert.equal(await page.getByText(LOST_REPLY, { exact: true }).count(), 1, "reconciliation duplicated the assistant reply")

  await waitForReady(page)
  const promptsBeforeReload = promptHttpBodies.length
  const dispatchesBeforeReload = nativePromptDispatches
  await page.reload({ waitUntil: "networkidle" })
  await openSession(page, false)
  await page.getByText(LOST_REPLY, { exact: true }).waitFor({ state: "visible" })
  assert.equal(claimCount, 1, "reload must reuse daemon-owned PI writer identity instead of claiming twice")
  assert.equal(promptHttpBodies.length, promptsBeforeReload, "refresh must never emit a native PI prompt")
  assert.equal(nativePromptDispatches, dispatchesBeforeReload, "refresh must never dispatch native PI work")
  for (const marker of [SUCCESS_PROMPT, SUCCESS_REPLY, ERROR_PROMPT, LOST_PROMPT, LOST_REPLY]) {
    assert.equal(await page.getByText(marker, { exact: true }).count(), 1, `refresh duplicated transcript marker: ${marker}`)
  }
  assert.equal(await page.getByRole("button", { name: "Continue with another agent" }).count(), 0, "cross-agent handoff UI must stay disabled during single-Session parity work")

  const composer = await page.locator(".uw-composer-shell").boundingBox()
  const size = page.viewportSize()
  assert.ok(composer && size, "v3 composer geometry unavailable")
  assert.ok(composer.y >= -1 && composer.y + composer.height <= size.height + 1, `v3 composer escaped viewport: ${JSON.stringify({ composer, size })}`)

  await context.close()
}

let daemon
let preview
let browser
try {
  resetFakeState()
  daemon = await startFakeDaemon()
  preview = startPreview()
  await ready(APP_ORIGIN)
  browser = await chromium.launch({ headless: true })

  console.log("native PI v3-first browser smoke: desktop")
  await assertSessionContract(browser, { width: 1366, height: 768 }, false)
  console.log("native PI v3-first browser smoke: mobile")
  await assertSessionContract(browser, { width: 390, height: 844 }, true)
  console.log("native PI v3-first browser smoke: single dispatch, ordered activity, error recovery, uncertain-delivery reconciliation, refresh and mobile passed")
} finally {
  if (browser) await browser.close().catch(() => {})
  stopPreview(preview)
  stopServer(daemon)
}
