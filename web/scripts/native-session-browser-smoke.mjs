import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { chromium } from "playwright"

const APP_PORT = 4319
const API_PORT = 4320
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const sessionID = "codex-native-session-1"
const directory = "/workspace/native-session-project"

function json(response, body, status = 200, headers = {}) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Harness-Backend",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    ...headers
  })
  response.end(JSON.stringify(body))
}

function message(id, role, text, created) {
  return {
    info: { id, role, time: { created } },
    parts: [{ id: `part-${id}`, type: "text", text }]
  }
}

const journalMessages = []
const liveMessages = []
for (let index = 0; index < 18; index += 1) {
  const first = index === 0
  const last = index === 17
  const userText = first
    ? `USER-FIRST-MARKER\n${"user transcript line ".repeat(12)}`
    : last
      ? `USER-LAST-MARKER\n${"user transcript line ".repeat(12)}`
      : `User turn ${index + 1}\n${"user transcript line ".repeat(12)}`
  const assistantText = first
    ? `ASSISTANT-FIRST-MARKER\n${"assistant transcript line ".repeat(14)}`
    : last
      ? `ASSISTANT-LAST-MARKER\n${"assistant transcript line ".repeat(14)}`
      : `Assistant reply ${index + 1}\n${"assistant transcript line ".repeat(14)}`
  const created = 1_000 + index * 10
  journalMessages.push(
    message(`journal-user-${index}`, "user", userText, created),
    message(`journal-assistant-${index}`, "assistant", assistantText, created + 1)
  )
  liveMessages.push(
    message(`live-user-${index}`, "user", userText, created),
    message(`live-assistant-${index}`, "assistant", assistantText, created + 1)
  )
}

let claimed = false

function startFakeDaemon() {
  return createServer((request, response) => {
    if (request.method === "OPTIONS") return json(response, {})
    const url = new URL(request.url || "/", API_ORIGIN)

    if (url.pathname === "/v1/machine") {
      return json(response, {
        machine: { id: "machine-browser-smoke", label: "Browser smoke" },
        agents: [{
          id: "codex",
          label: "Codex",
          backend: "codex",
          transport: "acp",
          managed: true,
          state: "available",
          capabilities: { sessions: true, abort: true, models: true },
          contract: { sessions: { stop: "owned-session-native-cancel" } }
        }]
      })
    }

    if (url.pathname === "/v1/projects") {
      return json(response, [{
        id: "project-native-session",
        machineId: "machine-browser-smoke",
        name: "native-session-project",
        path: directory,
        kind: "git"
      }])
    }

    if (url.pathname === "/v1/agents/codex/experimental/session") {
      return json(response, [{
        id: sessionID,
        title: "Codex CLI native session",
        directory,
        time: { created: 1_000, updated: 2_000 },
        external: true
      }])
    }

    if (url.pathname === "/v1/agents/codex/session") {
      return json(response, [{
        id: sessionID,
        title: "Codex CLI native session",
        directory,
        time: { created: 1_000, updated: 2_000 },
        external: true
      }])
    }

    if (url.pathname === "/v1/agents/codex/session/status") {
      return json(response, { [sessionID]: { type: "idle" } })
    }

    if (url.pathname === `/v1/agents/codex/session/${sessionID}/claim` && request.method === "POST") {
      claimed = true
      return json(response, { ok: true })
    }

    if (url.pathname === `/v1/agents/codex/session/${sessionID}/message`) {
      const page = claimed ? liveMessages : journalMessages
      return json(response, page, 200, {
        "X-Harness-Has-More": "false"
      })
    }

    if (url.pathname === `/v1/agents/codex/session/${sessionID}/prompt` && request.method === "POST") {
      return json(response, { state: "accepted" })
    }

    if (url.pathname === "/v1/agents/codex/config/providers") {
      return json(response, {
        providers: [{
          id: "openai",
          name: "OpenAI",
          models: [{ id: "gpt-5.6", name: "GPT-5.6", default: true }]
        }]
      })
    }

    return json(response, { error: `Unhandled fake route: ${request.method} ${url.pathname}` }, 404)
  }).listen(API_PORT, "127.0.0.1")
}

function startPreview() {
  return spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(APP_PORT)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"]
  })
}

function stopPreview(child) {
  if (!child || child.killed) return
  child.kill("SIGTERM")
}

function stopServer(server) {
  if (!server) return
  server.close()
}

async function ready(origin) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Preview did not become ready at ${origin}`)
}

async function seedProfile(page) {
  await page.addInitScript(({ host, port }) => {
    localStorage.clear()
    localStorage.setItem("harness.remote.profiles", JSON.stringify({
      version: 1,
      activeProfileID: "browser-smoke",
      profiles: [{
        id: "browser-smoke",
        label: "Browser smoke",
        config: {
          backend: "codex",
          host,
          port,
          username: "harness",
          password: "secret"
        }
      }]
    }))
  }, { host: "127.0.0.1", port: API_PORT })
}

async function assertSessionContract(browser, viewport, mobile) {
  claimed = false
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile })
  const page = await context.newPage()
  await seedProfile(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })

  const sessionRow = page.getByText("Codex CLI native session", { exact: true }).first()
  await sessionRow.waitFor({ state: "visible" })
  await sessionRow.click()

  const continueButton = page.getByRole("button", { name: /continue/i })
  await continueButton.waitFor({ state: "visible" })

  // Before claiming, the external journal is the read authority and the composer remains hidden.
  assert.equal(await page.locator(".uw-composer-shell").count(), 1)
  await continueButton.click()
  await page.locator(".uw-composer-shell textarea").waitFor({ state: "visible" })

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

  const transcript = page.locator(".uw-transcript")
  const scroll = await transcript.evaluate((element) => ({
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

  // TaskDeskConversation intentionally follows a newly loaded/sent turn while the reader remains at
  // the bottom. A real upward gesture exits that mode before the browser changes scrollTop. Signal
  // that same user intent here instead of assigning scrollTop behind React's back, then wait through
  // the pending follow frame. If the transcript returns to the bottom after this, the UI is genuinely
  // fighting the reader's scroll rather than the test manufacturing a race with autoscroll.
  await transcript.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }))
    element.scrollTop = 0
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const top = await transcript.evaluate((element) => element.scrollTop)
  assert.equal(top, 0, "native transcript cannot scroll independently to the top after user scroll intent")

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
