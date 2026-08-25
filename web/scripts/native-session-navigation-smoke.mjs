import assert from "node:assert/strict"
import http from "node:http"
import { spawn } from "node:child_process"
import { chromium } from "playwright"

const PREVIEW_PORT = 4179
const DAEMON_PORT = 4425
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const DIRECTORY = "/work/native-navigation"
const SESSION_A = "native-pi-navigation-a"
const SESSION_B = "native-pi-navigation-b"
const TITLE_A = "Navigation Session A"
const TITLE_B = "Navigation Session B"
const MARKER_A = "NAVIGATION-TRANSCRIPT-A"
const MARKER_B = "NAVIGATION-TRANSCRIPT-B"

const sessions = [
  { id: SESSION_A, title: TITLE_A, directory: DIRECTORY, external: true, time: { created: 1000, updated: 1001 } },
  { id: SESSION_B, title: TITLE_B, directory: DIRECTORY, external: true, time: { created: 2000, updated: 2001 } }
]

const transcripts = new Map([
  [SESSION_A, [{
    info: { id: "nav-a-user", role: "user", sessionID: SESSION_A, time: { created: 1000 } },
    parts: [{ id: "nav-a-text", type: "text", text: MARKER_A }]
  }]],
  [SESSION_B, [{
    info: { id: "nav-b-user", role: "user", sessionID: SESSION_B, time: { created: 2000 } },
    parts: [{ id: "nav-b-text", type: "text", text: MARKER_B }]
  }]]
])

let modelReads = 0
let sseResponses = new Set()

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Harness-Backend",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600"
  }
}

function json(response, status, value, extra = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(), ...extra })
  response.end(JSON.stringify(value))
}

function startFakeDaemon() {
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }

    const url = new URL(request.url || "/", `http://127.0.0.1:${DAEMON_PORT}`)
    if (request.method === "GET" && url.pathname === "/v1/machine") {
      json(response, 200, {
        machine: { id: "machine-native-navigation", name: "Native Navigation Test", createdAt: new Date().toISOString() },
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
        projects: [{ id: "project-native-navigation", machineId: "machine-native-navigation", name: "native-navigation", path: DIRECTORY, kind: "git", configured: true }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/experimental/session") {
      json(response, 200, sessions)
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/session/status") {
      json(response, 200, { [SESSION_A]: { type: "idle" }, [SESSION_B]: { type: "idle" } })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/pi/models") {
      modelReads += 1
      json(response, 200, {
        models: [{
          providerID: "pi",
          providerName: "PI",
          modelID: "pi-coding",
          modelName: "PI Coding",
          isDefault: true,
          tools: true
        }],
        stale: false,
        refreshedAt: new Date().toISOString(),
        source: "native-navigation-smoke"
      })
      return
    }

    const messageMatch = /^\/v1\/agents\/pi\/session\/([^/]+)\/message$/.exec(url.pathname)
    if (request.method === "GET" && messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1])
      json(response, 200, transcripts.get(sessionID) || [], { "X-Has-More": "0" })
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

    if (request.method === "GET" && (url.pathname.includes("/question") || url.pathname.includes("/permission"))) {
      json(response, 200, [])
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

async function seed(page) {
  await page.addInitScript(({ key, port }) => {
    localStorage.setItem(key, JSON.stringify([{
      id: "machine-native-navigation",
      name: "Native Navigation Test",
      config: { backend: "opencode", host: "127.0.0.1", port, username: "harness", password: "testpw" }
    }]))
  }, { key: STORAGE_KEY, port: DAEMON_PORT })
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

async function openAndAssert(page, title, marker, absentMarker) {
  await page.locator('.hr-native-workspace[aria-label="Sessions"]').waitFor({ state: "visible", timeout: 12_000 })
  await page.getByRole("button", { name: new RegExp(title) }).click()
  await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: 12_000 })
  await page.locator(".tdw-work-thread-conversation").waitFor({ state: "visible", timeout: 12_000 })
  await page.getByText(marker, { exact: true }).waitFor({ state: "visible", timeout: 12_000 })
  await page.locator(".uw-composer-shell").waitFor({ state: "visible", timeout: 12_000 })
  const composer = page.getByRole("textbox", { name: "Message PI" })
  await composer.waitFor({ state: "visible", timeout: 12_000 })
  assert.equal(await composer.isDisabled(), false, `${title} composer stayed disabled`)
  assert.equal(await page.getByText("Loading Session into the v3 controller...", { exact: true }).count(), 0, `${title} stayed in native controller loading state`)
  assert.equal(await page.getByText(marker, { exact: true }).count(), 1, `${title} transcript duplicated its marker`)
  assert.equal(await page.getByText(absentMarker, { exact: true }).count(), 0, `${title} retained the previous Session transcript`)
}

let daemon
let preview
let browser
try {
  daemon = await startFakeDaemon()
  preview = startPreview()
  await ready(APP_ORIGIN)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })

  await openAndAssert(page, TITLE_A, MARKER_A, MARKER_B)
  await openAndAssert(page, TITLE_B, MARKER_B, MARKER_A)
  await openAndAssert(page, TITLE_A, MARKER_A, MARKER_B)
  await openAndAssert(page, TITLE_B, MARKER_B, MARKER_A)

  assert.ok(modelReads >= 1, "sequential Session navigation never reached the mature model catalog path")
  assert.deepEqual(pageErrors, [], `browser errors during A -> B -> A -> B navigation: ${pageErrors.join(" | ")}`)
  console.log("native Session sequential navigation smoke: A -> B -> A -> B passed")
  await context.close()
} finally {
  if (browser) await browser.close().catch(() => {})
  for (const response of sseResponses) {
    try { response.end() } catch {}
  }
  stopPreview(preview)
  stopServer(daemon)
}