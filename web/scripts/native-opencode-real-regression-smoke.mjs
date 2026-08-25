import assert from "node:assert/strict"
import http from "node:http"
import { spawn } from "node:child_process"
import { chromium } from "playwright"

const PREVIEW_PORT = 4178
const DAEMON_PORT = 4424
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const MACHINE_ID = "machine-opencode-real-regressions"
const DIRECTORY = "/work/opencode-real-regressions"
const PRIMARY_ID = "opencode-primary-newer"
const OLDER_BUSY_ID = "opencode-older-busy"
const PRIMARY_TITLE = "Newer OpenCode Session"
const OLDER_TITLE = "Older Working OpenCode Session"
const PROMPT = "OPENCODE-STATUS-COMPLETION-PROMPT"
const FINAL = "OPENCODE-STATUS-COMPLETION-FINAL"
const SECOND_PROMPT = "OPENCODE-MODEL-RESTORE-SECOND"
const SECOND_FINAL = "OPENCODE-MODEL-RESTORE-SECOND-FINAL"
const LAST_MODEL = { providerID: "anthropic", modelID: "claude-sonnet-4-6", variant: "high" }

let transcripts
let statuses
let sessions
let sseResponses
let promptBodies
let clock

function userMessage(id, text, created, model = LAST_MODEL) {
  return {
    info: {
      id,
      role: "user",
      sessionID: PRIMARY_ID,
      time: { created },
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
        variant: model.variant
      }
    },
    parts: [{ id: `${id}-text`, type: "text", text }]
  }
}

function assistantMessage(id, text, created, model = LAST_MODEL) {
  return {
    info: {
      id,
      role: "assistant",
      sessionID: PRIMARY_ID,
      time: { created, completed: created },
      providerID: model.providerID,
      modelID: model.modelID
    },
    parts: [{ id: `${id}-text`, type: "text", text }]
  }
}

function resetState() {
  transcripts = new Map([
    [PRIMARY_ID, [
      userMessage("history-user", "HISTORY-USING-NONDEFAULT-MODEL", 4_900),
      assistantMessage("history-assistant", "HISTORY-NONDEFAULT-REPLY", 4_950)
    ]],
    [OLDER_BUSY_ID, []]
  ])
  statuses = new Map([
    [PRIMARY_ID, { type: "idle" }],
    [OLDER_BUSY_ID, { type: "busy" }]
  ])
  sessions = new Map([
    [PRIMARY_ID, {
      id: PRIMARY_ID,
      title: PRIMARY_TITLE,
      directory: DIRECTORY,
      external: true,
      time: { created: 4_000, updated: 5_000 }
    }],
    [OLDER_BUSY_ID, {
      id: OLDER_BUSY_ID,
      title: OLDER_TITLE,
      directory: DIRECTORY,
      external: true,
      time: { created: 900, updated: 1_000 }
    }]
  ])
  sseResponses = new Set()
  promptBodies = []
  clock = 10_000
}

const MODEL_CATALOG = {
  models: [
    {
      providerID: "openai",
      providerName: "OpenAI",
      modelID: "gpt-5.6-codex",
      modelName: "GPT-5.6 Codex",
      isDefault: true,
      tools: true
    },
    {
      providerID: LAST_MODEL.providerID,
      providerName: "Anthropic",
      modelID: LAST_MODEL.modelID,
      modelName: "Claude Sonnet 4.6",
      variant: LAST_MODEL.variant,
      tools: true
    }
  ],
  stale: false,
  refreshedAt: new Date().toISOString(),
  source: "opencode-real-regression-smoke"
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

function emit(type, properties) {
  const frame = `data: ${JSON.stringify({
    directory: DIRECTORY,
    payload: { type, properties }
  })}\n\n`
  for (const response of [...sseResponses]) {
    try { response.write(frame) }
    catch { sseResponses.delete(response) }
  }
}

function appendPrompt(sessionID, body) {
  const list = transcripts.get(sessionID) || []
  const created = clock++
  const model = {
    providerID: body.model?.providerID || LAST_MODEL.providerID,
    modelID: body.model?.modelID || LAST_MODEL.modelID,
    variant: body.variant || LAST_MODEL.variant
  }
  list.push({
    info: {
      id: `user-${created}`,
      role: "user",
      sessionID,
      time: { created },
      model
    },
    parts: [{ id: `user-${created}-text`, type: "text", text: body.text }]
  })
  transcripts.set(sessionID, list)
}

function completePrompt(sessionID, text, model) {
  const list = transcripts.get(sessionID) || []
  const created = clock++
  list.push({
    info: {
      id: `assistant-${created}`,
      role: "assistant",
      sessionID,
      time: { created, completed: created },
      providerID: model.providerID,
      modelID: model.modelID
    },
    parts: [{ id: `assistant-${created}-text`, type: "text", text }]
  })
  transcripts.set(sessionID, list)
  statuses.set(sessionID, { type: "idle" })
  const session = sessions.get(sessionID)
  if (session) session.time.updated = created

  // This is the real regression: no final message.updated is emitted. OpenCode's lifecycle event is
  // the authoritative completion signal, so the selected transcript must be re-read from status.
  emit("session.status", { sessionID, status: { type: "idle" } })
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
        machine: { id: MACHINE_ID, name: "OpenCode regression machine", createdAt: new Date().toISOString() },
        agents: [{
          id: "opencode",
          label: "OpenCode",
          backend: "opencode",
          transport: "http",
          managed: true,
          state: "available",
          capabilities: { sessions: true, prompt: true, abort: true, streaming: true, models: true },
          contract: { sessions: { stop: "native-abort" } }
        }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/projects") {
      json(response, 200, {
        projects: [{
          id: "project-opencode-real-regressions",
          machineId: MACHINE_ID,
          name: "opencode-real-regressions",
          path: DIRECTORY,
          kind: "git",
          configured: true
        }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/opencode/experimental/session") {
      json(response, 200, [...sessions.values()])
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/opencode/session/status") {
      json(response, 200, Object.fromEntries(statuses))
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/opencode/models") {
      json(response, 200, MODEL_CATALOG)
      return
    }

    const messageMatch = /^\/v1\/agents\/opencode\/session\/([^/]+)\/message$/.exec(url.pathname)
    if (request.method === "GET" && messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1])
      const all = transcripts.get(sessionID) || []
      const requestedLimit = Number(url.searchParams.get("limit")) || all.length
      const data = all.slice(Math.max(0, all.length - requestedLimit))
      json(response, 200, data, { "X-Has-More": "0" })
      return
    }

    if (request.method === "GET" && url.pathname.includes("/global/event")) {
      response.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      })
      response.write(": connected\n\n")
      sseResponses.add(response)
      request.on("close", () => sseResponses.delete(response))
      return
    }

    const promptMatch = /^\/v1\/agents\/opencode\/session\/([^/]+)\/prompt$/.exec(url.pathname)
    if (request.method === "POST" && promptMatch) {
      const sessionID = decodeURIComponent(promptMatch[1])
      const body = await requestJSON(request)
      promptBodies.push({ sessionID, ...body })

      const model = {
        providerID: body?.model?.providerID,
        modelID: body?.model?.modelID,
        variant: body?.variant
      }
      statuses.set(sessionID, { type: "busy" })
      appendPrompt(sessionID, body)
      emit("message.updated", { info: { sessionID } })
      json(response, 200, { status: "accepted", clientRequestId: body?.clientRequestId })

      const final = body?.text === SECOND_PROMPT ? SECOND_FINAL : FINAL
      setTimeout(() => completePrompt(sessionID, final, model), 220)
      return
    }

    if (request.method === "GET" && (url.pathname.includes("/question") || url.pathname.includes("/permission"))) {
      json(response, 200, [])
      return
    }

    if (request.method === "GET" && url.pathname.endsWith("/vcs")) {
      json(response, 200, {})
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
    stdio: [ "ignore", "pipe", "pipe" ],
    detached: process.platform !== "win32"
  })
}

async function ready(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Preview did not become ready: ${url}`)
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
  await page.addInitScript(({ key, port, machineID }) => {
    localStorage.setItem(key, JSON.stringify([{
      id: machineID,
      name: "OpenCode regression machine",
      config: {
        backend: "opencode",
        host: "127.0.0.1",
        port,
        username: "harness",
        password: "testpw"
      }
    }]))
  }, { key: STORAGE_KEY, port: DAEMON_PORT, machineID: MACHINE_ID })
}

async function openPrimary(page) {
  await page.locator('.hr-native-workspace[aria-label="Sessions"]').waitFor({ state: "visible" })
  const titles = await page.locator(".hr-native-session-row .hr-native-session-copy strong").allTextContents()
  assert.deepEqual(
    titles.slice(0, 2),
    [PRIMARY_TITLE, OLDER_TITLE],
    "Session order must follow native recent activity, not Working status"
  )

  await page.getByRole("button", { name: new RegExp(`Open ${PRIMARY_TITLE}`) }).click()
  await page.locator(".tdw-work-thread-conversation").waitFor({ state: "visible" })
  await page.locator(".uw-composer-shell").waitFor({ state: "visible" })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && sseResponses.size === 0) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.ok(sseResponses.size > 0, "OpenCode event stream did not connect")
}

async function send(page, text) {
  const composer = page.getByRole("textbox", { name: "Message OpenCode" })
  await composer.fill(text)
  const button = page.getByRole("button", { name: "Send" })
  await button.click()
}

async function assertCompletionAndModel(page, text, final) {
  const before = promptBodies.length
  await send(page, text)

  const deadline = Date.now() + 2_500
  while (Date.now() < deadline && promptBodies.length === before) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(promptBodies.length, before + 1)
  const body = promptBodies.at(-1)
  assert.deepEqual(body.model, {
    providerID: LAST_MODEL.providerID,
    modelID: LAST_MODEL.modelID
  }, "reopened OpenCode Session must keep the last native model")
  assert.equal(body.variant, LAST_MODEL.variant, "reopened OpenCode Session must keep the last native variant")

  await page.getByText(final, { exact: true }).waitFor({ state: "visible", timeout: 2_500 })
  await page.locator(".tdw-conversation-state.ready").waitFor({ state: "attached", timeout: 2_500 })
  assert.equal(await page.getByText(final, { exact: true }).count(), 1)
}

let daemon
let preview
let browser
try {
  resetState()
  daemon = await startFakeDaemon()
  preview = startPreview()
  await ready(APP_ORIGIN)
  browser = await chromium.launch({ headless: true })

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })

  await openPrimary(page)
  await assertCompletionAndModel(page, PROMPT, FINAL)

  // Returning to the Session must derive the picker from native message history again. No manual
  // model selection is performed before this second Send.
  await page.reload({ waitUntil: "networkidle" })
  await openPrimary(page)
  await assertCompletionAndModel(page, SECOND_PROMPT, SECOND_FINAL)

  await context.close()
  console.log("native OpenCode real-regression smoke: completion, model restore and stable ordering passed")
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const response of sseResponses || []) {
    try { response.end() } catch {}
  }
  stopPreview(preview)
  stopServer(daemon)
}
