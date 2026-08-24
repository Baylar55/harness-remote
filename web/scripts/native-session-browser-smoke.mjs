import assert from "node:assert/strict"
import http from "node:http"
import { spawn } from "node:child_process"
import { chromium } from "playwright"

const PREVIEW_PORT = 4175
const DAEMON_PORT = 4421
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const SESSION_ID = "native-codex-regression-1"
const DIRECTORY = "/work/native-session-regression"
const USER = "harness"
const PASSWORD = "testpw"

function message(id, role, text, created) {
  return {
    info: { id, role, sessionID: SESSION_ID, time: { created } },
    parts: [{ id: `${id}-text`, type: "text", text }]
  }
}

function transcript(prefix) {
  const messages = []
  for (let index = 0; index < 24; index += 1) {
    const first = index === 0
    const last = index === 23
    messages.push(message(
      `${prefix}-user-${index}`,
      "user",
      first ? "USER-FIRST-MARKER" : last ? "USER-LAST-MARKER" : `User turn ${index}: ${"context ".repeat(10)}`,
      1_000 + index * 2
    ))
    messages.push(message(
      `${prefix}-assistant-${index}`,
      "assistant",
      first ? "ASSISTANT-FIRST-MARKER" : last ? "ASSISTANT-LAST-MARKER" : `Assistant reply ${index}: ${"answer ".repeat(14)}`,
      1_001 + index * 2
    ))
  }
  return messages
}

const journalMessages = transcript("journal")
const liveMessages = transcript("live")
let claimCount = 0

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
        machine: { id: "machine-native-regression", name: "Native Session Test", createdAt: new Date().toISOString() },
        agents: [{
          id: "codex",
          label: "Codex CLI",
          backend: "codex",
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
        projects: [{
          id: "project-native-regression",
          machineId: "machine-native-regression",
          name: "native-session-regression",
          path: DIRECTORY,
          kind: "git",
          configured: true
        }]
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/codex/experimental/session") {
      json(response, 200, [{
        id: SESSION_ID,
        title: "Codex CLI regression session",
        directory: DIRECTORY,
        external: true,
        time: { created: 1_000, updated: 2_000 }
      }])
      return
    }

    if (request.method === "GET" && url.pathname === "/v1/agents/codex/session/status") {
      json(response, 200, { [SESSION_ID]: { type: "idle" } })
      return
    }

    if (request.method === "GET" && url.pathname === `/v1/agents/codex/session/${SESSION_ID}/message`) {
      const refresh = url.searchParams.get("refresh") === "1"
      json(response, 200, refresh ? liveMessages : journalMessages, {
        "X-Has-More": "0"
      })
      return
    }

    if (request.method === "POST" && url.pathname === `/v1/agents/codex/session/${SESSION_ID}/claim`) {
      claimCount += 1
      json(response, 200, { ok: true })
      return
    }

    // The observer may attempt to establish live refresh. A failed optional stream must not affect
    // the authoritative transcript reads used by this regression smoke.
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
  await page.addInitScript(({ key, port, user, password }) => {
    localStorage.setItem(key, JSON.stringify([{
      id: "machine-native-regression",
      name: "Native Session Test",
      config: { backend: "opencode", host: "127.0.0.1", port, username: user, password }
    }]))
  }, { key: STORAGE_KEY, port: DAEMON_PORT, user: USER, password: PASSWORD })
}

async function assertSessionContract(browser, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })

  const sessionsTab = page.locator('.hr-mobile-nav button[aria-current="page"]').filter({ hasText: "Sessions" })
  if (mobile) await sessionsTab.waitFor({ state: "visible" })
  await page.locator('.hr-native-workspace[aria-label="Sessions"]').waitFor({ state: "visible" })

  await page.getByRole("button", { name: /Codex CLI regression session/ }).click()
  await page.locator(".hr-native-session-observer").waitFor({ state: "visible" })
  await page.getByText("ASSISTANT-FIRST-MARKER", { exact: true }).waitFor({ state: "visible" })

  assert.equal(await page.locator(".uw-composer-shell").isVisible(), false, "external ACP Session must begin observe-only")

  await page.getByRole("button", { name: "Continue this Session" }).click()
  await page.locator(".uw-composer-shell").waitFor({ state: "visible" })
  assert.equal(claimCount > 0, true, "Continue must cross the explicit ACP claim boundary")

  // Journal and ACP replay deliberately use different ids for the same semantic transcript in this
  // fixture. The UI must show one native response, never both authorities merged together.
  assert.equal(await page.getByText("ASSISTANT-FIRST-MARKER", { exact: true }).count(), 1, "first assistant response was duplicated after claim")
  assert.equal(await page.getByText("ASSISTANT-LAST-MARKER", { exact: true }).count(), 1, "last assistant response was duplicated after claim")

  const order = await page.locator(".uw-transcript").evaluate((element) => {
    const text = element.textContent || ""
    return [
      text.indexOf("USER-FIRST-MARKER"),
      text.indexOf("ASSISTANT-FIRST-MARKER"),
      text.indexOf("USER-LAST-MARKER"),
      text.indexOf("ASSISTANT-LAST-MARKER")
    ]
  })
  assert.ok(order.every((value) => value >= 0), `transcript markers missing: ${order.join(",")}`)
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], `native transcript order regressed: ${order.join(",")}`)

  const scroll = await page.locator(".uw-transcript").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY
  }))
  assert.ok(scroll.scrollHeight > scroll.clientHeight + 20, `native transcript is not actually scrollable: ${JSON.stringify(scroll)}`)
  assert.ok(scroll.overflowY === "auto" || scroll.overflowY === "scroll", `native transcript does not own vertical scrolling: ${scroll.overflowY}`)

  const composer = await page.locator(".uw-composer-shell").boundingBox()
  const size = page.viewportSize()
  assert.ok(composer && size, "composer geometry unavailable")
  assert.ok(composer.y >= -1 && composer.y + composer.height <= size.height + 1, `composer escaped the viewport: ${JSON.stringify({ composer, size })}`)

  await page.locator(".uw-transcript").evaluate((element) => { element.scrollTop = 0 })
  const top = await page.locator(".uw-transcript").evaluate((element) => element.scrollTop)
  assert.equal(top, 0, "native transcript cannot scroll independently to the top")

  await context.close()
}

let daemon
let preview
let browser
try {
  daemon = await startFakeDaemon()
  preview = startPreview()
  await ready(APP_ORIGIN)
  browser = await chromium.launch({ headless: true })

  console.log("native Session browser smoke: desktop")
  await assertSessionContract(browser, { width: 1366, height: 768 }, false)
  console.log("native Session browser smoke: mobile")
  await assertSessionContract(browser, { width: 390, height: 844 }, true)
  console.log("native Session browser smoke: single reply, ordering, scrolling and composer containment passed")
} finally {
  if (browser) await browser.close().catch(() => {})
  stopPreview(preview)
  stopServer(daemon)
}
