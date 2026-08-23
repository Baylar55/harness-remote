import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import { spawn } from "node:child_process"
import { chromium } from "playwright"

const PREVIEW_PORT = 4174
const APP_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`
const STORAGE_KEY = "harness-remote.workspace.machines.v1"
const OUT = path.resolve("browser-artifacts")
const USER = "harness"
const PASSWORD = "testpw"
const now = new Date().toISOString()

const agentDefinitions = [
  ["opencode", "OpenCode", "http"],
  ["omp", "Oh My Pi", "acp"],
  ["pi", "PI", "acp"],
  ["codex", "Codex CLI", "acp"],
  ["claude", "Claude Code", "acp"]
]

function agents() {
  return agentDefinitions.map(([id, label, transport]) => ({
    id,
    label,
    backend: id,
    transport,
    managed: true,
    state: "available",
    capabilities: {
      sessions: true,
      prompt: true,
      abort: true,
      streaming: true,
      models: true,
      filesystemBrowser: true,
      commands: true
    }
  }))
}

const fixtures = [
  {
    id: "machine-a-controls",
    name: "Windows Workstation",
    port: 4411,
    project: { id: "project-a-controls", machineId: "machine-a-controls", name: "harness-win", path: "C:\\work\\harness-win", kind: "git", configured: true },
    conversation: {
      id: "conversation-a-controls",
      machineId: "machine-a-controls",
      projectId: "project-a-controls",
      project: { name: "harness-win", path: "C:\\work\\harness-win", kind: "git" },
      title: "Audit Windows UI",
      agentId: "pi",
      prompt: "Audit the Windows UI",
      model: null,
      status: "completed",
      workspace: { mode: "project", path: "C:\\work\\harness-win" },
      run: null,
      runs: [],
      error: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    }
  },
  {
    id: "machine-b-controls",
    name: "Linux Workstation",
    port: 4412,
    project: { id: "project-b-controls", machineId: "machine-b-controls", name: "harness-linux", path: "/work/harness-linux", kind: "git", configured: true },
    conversation: {
      id: "conversation-b-controls",
      machineId: "machine-b-controls",
      projectId: "project-b-controls",
      project: { name: "harness-linux", path: "/work/harness-linux", kind: "git" },
      title: "Audit Linux UI",
      agentId: "codex",
      prompt: "Audit the Linux UI",
      model: null,
      status: "completed",
      workspace: { mode: "project", path: "/work/harness-linux" },
      run: null,
      runs: [],
      error: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    }
  }
]

function headers() {
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
  }
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers() })
  response.end(JSON.stringify(value))
}

function fakeDaemon(fixture) {
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers())
      response.end()
      return
    }
    const url = new URL(request.url || "/", `http://127.0.0.1:${fixture.port}`)
    if (request.method === "GET" && url.pathname === "/v1/machine") {
      json(response, 200, { machine: { id: fixture.id, name: fixture.name, createdAt: now }, agents: agents() })
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/projects") {
      json(response, 200, { projects: [fixture.project] })
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/work-threads") {
      json(response, 200, { workThreads: [fixture.conversation] })
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/tasks") {
      json(response, 200, { tasks: [fixture.conversation] })
      return
    }
    if (request.method === "GET" && url.pathname === `/v1/work-threads/${fixture.conversation.id}`) {
      json(response, 200, fixture.conversation)
      return
    }
    const model = /^\/v1\/agents\/([^/]+)\/models$/.exec(url.pathname)
    if (request.method === "GET" && model) {
      const id = decodeURIComponent(model[1])
      const label = agentDefinitions.find(([candidate]) => candidate === id)?.[1] || id
      json(response, 200, {
        models: [{ providerID: id, providerName: label, modelID: `${id}-model`, modelName: `${label} Model`, isDefault: true, contextLimit: 128000 }],
        stale: false,
        refreshedAt: now
      })
      return
    }
    json(response, 404, { error: `No fake route for ${request.method} ${url.pathname}` })
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(fixture.port, "127.0.0.1", () => resolve(server))
  })
}

function preview() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm"
  return spawn(command, ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  })
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

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
}

async function insideViewport(page, locator, label) {
  await locator.waitFor({ state: "visible" })
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && viewport, `${label}: no geometry`)
  assert.ok(box.x >= -1 && box.y >= -1, `${label}: starts outside viewport`)
  assert.ok(box.x + box.width <= viewport.width + 1, `${label}: clipped horizontally`)
  assert.ok(box.y + box.height <= viewport.height + 1, `${label}: clipped vertically`)
}

async function waitForDrawerSettled(page, selector) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target)
    if (!element) return false
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return box.x >= -1 && Number(style.opacity) >= 0.999 && style.visibility === "visible"
  }, selector)
}

async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }))
  assert.ok(result.doc <= result.width + 1, `${label}: document width ${result.doc} > ${result.width}`)
  assert.ok(result.body <= result.width + 1, `${label}: body width ${result.body} > ${result.width}`)
}

async function seed(page) {
  await page.addInitScript(({ key, fixtures, user, password }) => {
    localStorage.setItem(key, JSON.stringify(fixtures.map((fixture) => ({
      id: fixture.id,
      name: fixture.name,
      config: { backend: "opencode", host: "127.0.0.1", port: fixture.port, username: user, password }
    }))))
  }, { key: STORAGE_KEY, fixtures, user: USER, password: PASSWORD })
}

async function newConversationAudit(page, label) {
  await page.locator(".hr-new-conversation").click()
  const dialog = page.getByRole("dialog", { name: "New conversation" })
  await dialog.waitFor({ state: "visible" })
  await insideViewport(page, dialog, `${label} New Conversation`)

  const machine = dialog.getByLabel("Machine")
  const project = dialog.getByLabel("Project")
  const agent = dialog.getByLabel("Coding agent")
  const prompt = dialog.getByLabel("First message")
  const cancel = dialog.getByRole("button", { name: "Cancel" })
  const start = dialog.getByRole("button", { name: /Start conversation/ })
  for (const [locator, name] of [[machine, "Machine"], [project, "Project"], [agent, "Coding agent"], [prompt, "First message"], [cancel, "Cancel"], [start, "Start conversation"]]) {
    await locator.waitFor({ state: "visible" })
    await locator.scrollIntoViewIfNeeded()
    await insideViewport(page, locator, `${label} ${name}`)
  }

  assert.equal(await machine.locator("option").count(), 2, `${label}: New Conversation must expose both machines`)
  assert.equal(await agent.locator("option").count(), 5, `${label}: New Conversation must expose all five harnesses`)
  assert.equal(await start.isDisabled(), true, `${label}: Start should stay disabled until a first message exists`)

  for (const [id, text] of [["pi", "PI Model"], ["codex", "Codex CLI Model"], ["claude", "Claude Code Model"], ["omp", "Oh My Pi Model"], ["opencode", "OpenCode Model"]]) {
    await agent.selectOption(id)
    const trigger = dialog.locator(".tdw-model-trigger")
    await trigger.getByText(text, { exact: false }).waitFor({ state: "visible", timeout: 10_000 })
    assert.equal(await dialog.locator(".tdw-field-note").count(), 0, `${label}: ${id} fell back to unavailable model catalog`)
  }

  await machine.selectOption(fixtures[1].id)
  await project.locator(`option[value="${fixtures[1].project.id}"]`).waitFor({ state: "attached" })
  assert.equal(await project.inputValue(), fixtures[1].project.id, `${label}: switching machine did not switch Project`)

  await prompt.fill("Audit this candidate")
  assert.equal(await start.isDisabled(), false, `${label}: Start did not enable after entering a message`)
  await noOverflow(page, `${label} New Conversation`)
  await shot(page, `${label}-new-conversation`)
  await cancel.click()
  await dialog.waitFor({ state: "hidden" })
}

async function runMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })
  await page.locator(".hr-mobile-nav").waitFor({ state: "visible" })
  await page.locator(".tdw-machine-section").waitFor({ state: "visible" })
  await shot(page, "portrait-list")
  await noOverflow(page, "portrait list")
  await newConversationAudit(page, "portrait")

  await page.getByRole("button", { name: /Audit Windows UI/ }).click()
  await page.locator(".tdw-main.mobile-open").waitFor({ state: "visible" })
  await shot(page, "portrait-conversation")

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(200)
  await page.locator(".tdw-main.mobile-open").waitFor({ state: "visible" })
  await page.locator(".tdw-mobile-back").waitFor({ state: "visible" })
  await insideViewport(page, page.locator(".tdw-main.mobile-open"), "landscape Conversation")
  await noOverflow(page, "landscape Conversation")
  await shot(page, "landscape-conversation")

  await page.locator(".tdw-mobile-back").click()
  await page.locator(".hr-mobile-nav").waitFor({ state: "visible" })
  await shot(page, "landscape-list")
  await newConversationAudit(page, "landscape")

  await page.locator(".hr-mobile-nav").getByRole("button", { name: /Machines/ }).click()
  await page.locator(".uw-machine-manager").waitFor({ state: "visible" })
  await shot(page, "landscape-machines")
  await noOverflow(page, "landscape Machines")

  await page.locator(".hr-mobile-nav").getByRole("button", { name: /Conversations/ }).click()
  await page.locator(".hr-mobile-nav").getByRole("button", { name: /Settings/ }).click()
  await page.locator(".hr-mobile-settings-page").waitFor({ state: "visible" })
  await shot(page, "landscape-settings")
  await noOverflow(page, "landscape Settings")
  await context.close()
}

async function runDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await seed(page)
  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" })
  await page.locator(".tdw-topbar").waitFor({ state: "visible" })
  await shot(page, "desktop-list")
  await noOverflow(page, "desktop list")
  await newConversationAudit(page, "desktop")

  const conversationsToggle = page.locator(".tdw-tasks-toggle")
  const drawer = page.locator(".tdw-thread-column")
  await conversationsToggle.click()
  await drawer.waitFor({ state: "visible" })
  await waitForDrawerSettled(page, ".tdw-thread-column")
  const drawerGeometry = await page.evaluate(() => {
    const workspace = document.querySelector(".tdw-project-column")?.getBoundingClientRect()
    const drawer = document.querySelector(".tdw-thread-column")?.getBoundingClientRect()
    if (!workspace || !drawer) return null
    return { workspaceRight: workspace.right, drawerLeft: drawer.left }
  })
  assert.ok(drawerGeometry, "desktop drawer geometry unavailable")
  assert.ok(drawerGeometry.drawerLeft >= drawerGeometry.workspaceRight - 1, `desktop drawer overlaps workspace: ${drawerGeometry.drawerLeft} < ${drawerGeometry.workspaceRight}`)
  await shot(page, "desktop-drawer")
  await page.getByRole("button", { name: /Audit Windows UI/ }).click()
  await drawer.waitFor({ state: "hidden" })
  await page.locator(".tdw-main").waitFor({ state: "visible" })
  await shot(page, "desktop-conversation")
  await noOverflow(page, "desktop conversation")
  await context.close()
}

await mkdir(OUT, { recursive: true })
const servers = []
let vite
let browser
try {
  for (const fixture of fixtures) servers.push(await fakeDaemon(fixture))
  vite = preview()
  await ready(APP_ORIGIN)
  browser = await chromium.launch({ headless: true })
  console.log("v3 browser controls smoke: mobile controls audit start")
  await runMobile(browser)
  console.log("v3 browser controls smoke: mobile controls audit passed")
  await runDesktop(browser)
  console.log("v3 browser controls smoke: desktop controls audit passed")
  console.log("v3 browser controls smoke: controls, model catalogs and screenshots passed")
} finally {
  if (browser) await browser.close().catch(() => {})
  stopPreview(vite)
  for (const server of servers) stopServer(server)
}
