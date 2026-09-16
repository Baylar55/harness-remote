import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const API_KEY = process.env.OPENCODE_ZEN_API_KEY?.trim()
if (!API_KEY) throw new Error("OPENCODE_ZEN_API_KEY is required for the real OpenCode release gate")

const PREVIEW_PORT = 4189
const DAEMON_PORT = 4497
const OPENCODE_PORT = 4496
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const USERNAME = "harness"
const PASSWORD = "live-zen-release-gate"
const SESSION_TITLE = `Live Zen Release Gate ${Date.now()}`
const FREE_MODEL_IDS = [
  "mimo-v2.5-free",
  "deepseek-v4-flash-free",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
  "laguna-s-2.1-free",
  "ling-3.0-tiny-free",
  "longcat-2.0-free",
  "big-pickle"
]
const TURN_TOKENS = [
  "LIVE-OPENCODE-TURN-1",
  "LIVE-OPENCODE-TURN-2",
  "LIVE-OPENCODE-TURN-3",
  "LIVE-OPENCODE-AFTER-RELOAD",
  "LIVE-OPENCODE-AFTER-RESTART"
]

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const viteCLI = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url))
const daemonCLI = path.join(repoRoot, "bridge", "src", "daemon-cli.js")
const artifactsDir = path.join(repoRoot, "web", "browser-artifacts")
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-remote-live-opencode-"))
const home = path.join(tempRoot, "home")
const project = path.join(tempRoot, "project")
const stateDir = path.join(tempRoot, "state")
const configDir = path.join(home, ".config", "opencode")
const dataDir = path.join(home, ".local", "share", "opencode")

fs.mkdirSync(configDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(project, { recursive: true })
fs.mkdirSync(stateDir, { recursive: true })
fs.mkdirSync(artifactsDir, { recursive: true })
fs.writeFileSync(path.join(project, "README.md"), "# Harness Remote live OpenCode release gate\n\nSynthetic CI project.\n")
try { execFileSync("git", ["init", "-q", project]) } catch {}

const authPath = path.join(dataDir, "auth.json")
fs.writeFileSync(authPath, `${JSON.stringify({ opencode: { type: "api", key: API_KEY } }, null, 2)}\n`, { mode: 0o600 })

function writeOpenCodeConfig(model) {
  const config = {
    $schema: "https://opencode.ai/config.json",
    ...(model ? { model: `${model.providerID}/${model.modelID}`, small_model: `${model.providerID}/${model.modelID}` } : {})
  }
  fs.writeFileSync(path.join(configDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`)
}
writeOpenCodeConfig(null)

const runtimeEnv = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  OPENCODE_ZEN_API_KEY: undefined
}
delete runtimeEnv.OPENCODE_ZEN_API_KEY

let daemon
let preview
let browser
let context
let page
let daemonLog = ""
let chosenModel = null
let machineID = null
let liveSessionID = null

function sanitize(value) {
  return String(value ?? "").split(API_KEY).join("[REDACTED]")
}

function appendDaemonLog(prefix, chunk) {
  daemonLog = `${daemonLog}${prefix}${sanitize(chunk)} `.slice(-120_000)
}

function authHeaders(json = false) {
  return {
    Authorization: `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {})
  }
}

async function http(pathname, { method = "GET", body, timeout = 30_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(`http://127.0.0.1:${DAEMON_PORT}${pathname}`, {
      method,
      headers: authHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    let payload = text
    try { payload = text ? JSON.parse(text) : true } catch {}
    if (!response.ok) throw new Error(`${method} ${pathname} -> HTTP ${response.status}: ${sanitize(text).slice(0, 1500)}`)
    return payload
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor(description, predicate, timeout = 30_000, interval = 250) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`)
}

function spawnDaemon() {
  daemonLog = ""
  const args = [
    daemonCLI,
    "--backend", "codex",
    "--host", "127.0.0.1",
    "--port", String(DAEMON_PORT),
    "--username", USERNAME,
    "--password", PASSWORD,
    "--root", project,
    "--state-dir", stateDir,
    "--cors", APP_ORIGIN,
    "--opencode-port", String(OPENCODE_PORT),
    "--opencode-timeout", "60000"
  ]
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: runtimeEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  })
  child.stdout.on("data", (chunk) => appendDaemonLog("[stdout] ", chunk))
  child.stderr.on("data", (chunk) => appendDaemonLog("[stderr] ", chunk))
  child.once("exit", (code, signal) => appendDaemonLog("[exit] ", `code=${code} signal=${signal}`))
  return child
}

function terminate(child) {
  if (!child || child.killed || !child.pid) return
  try {
    if (process.platform === "win32") child.kill("SIGTERM")
    else process.kill(-child.pid, "SIGTERM")
  } catch {
    try { child.kill("SIGTERM") } catch {}
  }
}

async function startDaemon() {
  daemon = spawnDaemon()
  const snapshot = await waitFor("Harness daemon", async () => {
    if (daemon.exitCode != null) throw new Error(`daemon exited ${daemon.exitCode}: ${daemonLog}`)
    try { return await http("/v1/machine", { timeout: 2_000 }) } catch { return null }
  }, 45_000)
  machineID = snapshot?.machine?.id || snapshot?.id || machineID
  assert.ok(machineID, `machine id missing from /v1/machine: ${JSON.stringify(snapshot)}`)
  return snapshot
}

async function stopDaemon() {
  const child = daemon
  daemon = null
  if (!child) return
  terminate(child)
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ])
}

function startPreview() {
  return spawn(process.execPath, [viteCLI, "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], {
    cwd: path.join(repoRoot, "web"),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  })
}

async function createSession(title) {
  const result = await http(`/v1/agents/opencode/session?directory=${encodeURIComponent(project)}`, {
    method: "POST",
    body: { title },
    timeout: 60_000
  })
  const id = result?.id || result?.sessionID || result?.sessionId
  assert.ok(id, `OpenCode create Session returned no id: ${JSON.stringify(result)}`)
  return id
}

function assistantFinal(messages, token) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info?.role !== "assistant") continue
    const text = (message.parts || []).filter((part) => part?.type === "text").map((part) => part.text || "").join("\n")
    if (text.includes(token)) return message
  }
  return null
}

async function messages(sessionID) {
  const payload = await http(`/v1/agents/opencode/session/${encodeURIComponent(sessionID)}/message?directory=${encodeURIComponent(project)}&limit=100`, { timeout: 15_000 })
  return Array.isArray(payload) ? payload : Array.isArray(payload?.messages) ? payload.messages : []
}

async function stopSession(sessionID) {
  try {
    await http(`/v1/agents/opencode/session/${encodeURIComponent(sessionID)}/stop`, {
      method: "POST",
      body: { directory: project, clientRequestId: `stop-${Date.now()}` },
      timeout: 15_000
    })
  } catch {}
}

async function sendDirect(sessionID, model, text, requestID) {
  return http(`/v1/agents/opencode/session/${encodeURIComponent(sessionID)}/prompt`, {
    method: "POST",
    body: {
      clientRequestId: requestID,
      text,
      directory: project,
      model: { providerID: model.providerID, modelID: model.modelID }
    },
    timeout: 30_000
  })
}

function modelCandidates(catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : Array.isArray(catalog) ? catalog : []
  const usable = models.filter((model) => model?.providerID && model?.modelID)
  const rank = (model) => {
    const exact = FREE_MODEL_IDS.indexOf(model.modelID)
    if (exact >= 0) return exact
    const label = `${model.modelID} ${model.modelName || ""} ${model.name || ""}`.toLowerCase()
    return label.includes("free") ? FREE_MODEL_IDS.length + 1 : 10_000
  }
  return usable
    .filter((model) => rank(model) < 10_000)
    .sort((a, b) => rank(a) - rank(b))
}

async function chooseResponsiveFreeModel() {
  const catalog = await http("/v1/agents/opencode/models", { timeout: 90_000 })
  const candidates = modelCandidates(catalog)
  assert.ok(candidates.length, `No OpenCode Zen free models found. Catalog sample: ${JSON.stringify(catalog).slice(0, 5000)}`)
  const attempts = []
  for (const model of candidates.slice(0, 8)) {
    const sessionID = await createSession(`Zen probe ${model.modelID} ${Date.now()}`)
    const token = `ZEN-PROBE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
    const started = Date.now()
    try {
      await sendDirect(sessionID, model, `Reply with exactly ${token} and nothing else.`, `probe-${Date.now()}-${model.modelID}`)
      const found = await waitFor(`${model.modelID} probe final`, async () => {
        const current = await messages(sessionID)
        return assistantFinal(current, token) ? current : null
      }, 75_000, 1_000)
      attempts.push({ model: `${model.providerID}/${model.modelID}`, ok: true, ms: Date.now() - started })
      return { model: { providerID: model.providerID, modelID: model.modelID, modelName: model.modelName || model.name || model.modelID }, attempts, transcript: found }
    } catch (error) {
      attempts.push({ model: `${model.providerID}/${model.modelID}`, ok: false, ms: Date.now() - started, error: sanitize(error.message).slice(0, 600) })
      await stopSession(sessionID)
    }
  }
  throw new Error(`No free Zen model completed a probe. Attempts: ${JSON.stringify(attempts)}`)
}

async function seedBrowser(page) {
  await page.addInitScript(({ key, machineID, port, username, password }) => {
    localStorage.setItem(key, JSON.stringify([{
      id: machineID,
      name: "Live OpenCode CI machine",
      config: { backend: "codex", host: "127.0.0.1", port, username, password }
    }]))
  }, { key: STORAGE_KEY, machineID, port: DAEMON_PORT, username: USERNAME, password: PASSWORD })
}

async function openLiveSession(page) {
  await page.locator('.hr-native-home[aria-label="Sessions"]').waitFor({ state: "visible", timeout: 30_000 })
  const button = page.getByRole("button", { name: new RegExp(SESSION_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
  await button.waitFor({ state: "visible", timeout: 30_000 })
  await button.click()
  await page.locator(".hr-native-session-observer").waitFor({ state: "visible", timeout: 20_000 })
  await page.locator(".uw-composer-shell").waitFor({ state: "visible", timeout: 20_000 })
}

async function waitReady(page, timeout = 90_000) {
  await page.locator(".tdw-conversation-state.ready").waitFor({ state: "attached", timeout })
  const composer = page.getByRole("textbox", { name: "Message OpenCode" })
  await composer.waitFor({ state: "visible", timeout: 20_000 })
  await waitFor("enabled OpenCode composer", async () => !(await composer.isDisabled()), 20_000, 200)
}

function finalLocator(page, token) {
  return page.locator(".uw-message-agent:not(.uw-message-pending) .uw-message-content-group .uw-markdown").filter({ hasText: token })
}

function reasoningLocator(page, token) {
  return page.locator(".uw-message-agent .uw-activity-group .uw-reasoning").filter({ hasText: token })
}

async function sendUI(page, token) {
  await waitReady(page)
  const composer = page.getByRole("textbox", { name: "Message OpenCode" })
  await composer.fill(`Reply with exactly ${token} and nothing else.`)
  const send = page.getByRole("button", { name: "Send" })
  await waitFor("enabled Send", async () => !(await send.isDisabled()), 15_000, 100)
  await send.click()

  const final = finalLocator(page, token)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await final.count()) {
      await waitReady(page, 30_000)
      assert.equal(await final.count(), 1, `${token}: final answer duplicated`)
      return
    }
    const ready = await page.locator(".tdw-conversation-state.ready").count()
    const reasoningOnly = await reasoningLocator(page, token).count()
    if (ready && reasoningOnly) {
      throw new Error(`${token}: Session became Ready with the requested token only in reasoning/activity and no final assistant answer`)
    }
    await page.waitForTimeout(500)
  }
  throw new Error(`${token}: no final assistant answer after 120s`)
}

async function snapshotDiagnostics(label) {
  const safe = {
    label,
    chosenModel,
    machineID,
    liveSessionID,
    opencodeVersion: process.env.OPENCODE_TEST_VERSION || "unknown",
    daemonLog: sanitize(daemonLog),
    bodyText: page ? sanitize(await page.locator("body").innerText().catch(() => "")) : "",
    transcript: liveSessionID ? await messages(liveSessionID).catch((error) => [{ diagnosticError: sanitize(error.message) }]) : []
  }
  fs.writeFileSync(path.join(artifactsDir, "live-opencode-diagnostics.json"), `${JSON.stringify(safe, null, 2)}\n`)
  if (page) await page.screenshot({ path: path.join(artifactsDir, "live-opencode-failure.png"), fullPage: true }).catch(() => {})
}

try {
  console.log("live OpenCode gate: starting real Harness Remote machine daemon")
  await startDaemon()

  console.log("live OpenCode gate: discovering a responsive Zen free model")
  const selected = await chooseResponsiveFreeModel()
  chosenModel = selected.model
  console.log(`live OpenCode gate: selected ${chosenModel.providerID}/${chosenModel.modelID}; probe attempts=${selected.attempts.length}`)

  console.log("live OpenCode gate: restarting OpenCode with the selected free model as native default")
  await stopDaemon()
  writeOpenCodeConfig(chosenModel)
  await startDaemon()
  await http("/v1/agents/opencode/models", { timeout: 90_000 })

  liveSessionID = await createSession(SESSION_TITLE)
  console.log(`live OpenCode gate: created native Session ${liveSessionID}`)

  preview = startPreview()
  await waitFor("Vite preview", async () => {
    try { return (await fetch(APP_ORIGIN)).ok } catch { return false }
  }, 30_000)

  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "en-US" })
  page = await context.newPage()
  await seedBrowser(page)
  await page.goto(APP_ORIGIN, { waitUntil: "domcontentloaded" })
  await openLiveSession(page)

  console.log("live OpenCode gate: real same-Session turn 1")
  await sendUI(page, TURN_TOKENS[0])
  console.log("live OpenCode gate: real same-Session turn 2")
  await sendUI(page, TURN_TOKENS[1])
  console.log("live OpenCode gate: real same-Session turn 3")
  await sendUI(page, TURN_TOKENS[2])

  console.log("live OpenCode gate: reload/remount without redispatch")
  await page.reload({ waitUntil: "domcontentloaded" })
  await openLiveSession(page)
  for (const token of TURN_TOKENS.slice(0, 3)) {
    assert.equal(await finalLocator(page, token).count(), 1, `${token}: durable final missing/duplicated after reload`)
  }
  await sendUI(page, TURN_TOKENS[3])

  console.log("live OpenCode gate: full Harness daemon/OpenCode restart and durable continuation")
  await stopDaemon()
  await startDaemon()
  await page.reload({ waitUntil: "domcontentloaded" })
  await openLiveSession(page)
  for (const token of TURN_TOKENS.slice(0, 4)) {
    assert.equal(await finalLocator(page, token).count(), 1, `${token}: durable final missing/duplicated after daemon restart`)
  }
  await sendUI(page, TURN_TOKENS[4])

  const finalMessages = await messages(liveSessionID)
  for (const token of TURN_TOKENS) {
    assert.ok(assistantFinal(finalMessages, token), `${token}: native transcript has no durable final`)
    assert.equal(await finalLocator(page, token).count(), 1, `${token}: UI final missing/duplicated at release gate end`)
  }
  assert.equal(await page.locator(".uw-message-pending").count(), 0, "release gate ended with a pending assistant row")
  assert.equal(await page.locator(".tdw-conversation-state.working").count(), 0, "release gate ended Working")
  assert.equal(await page.locator(".uw-activity-group.uw-tool-running").count(), 0, "release gate ended with running Activity")

  await page.screenshot({ path: path.join(artifactsDir, "live-opencode-passed.png"), fullPage: true })
  fs.writeFileSync(path.join(artifactsDir, "live-opencode-result.json"), `${JSON.stringify({
    status: "passed",
    chosenModel,
    turns: TURN_TOKENS.length,
    sessionID: liveSessionID
  }, null, 2)}\n`)
  console.log("live OpenCode gate: PASS — five real turns, reload, daemon restart, durable finals")
} catch (error) {
  console.error(`live OpenCode gate: FAIL — ${sanitize(error?.stack || error)}`)
  await snapshotDiagnostics("failure").catch(() => {})
  process.exitCode = 1
} finally {
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  terminate(preview)
  await stopDaemon().catch(() => {})
  try { fs.rmSync(authPath, { force: true }) } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch {}
}
