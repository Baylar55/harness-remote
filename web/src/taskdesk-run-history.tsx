import ReactMarkdown from "react-markdown"
import { createRoot, type Root } from "react-dom/client"
import remarkGfm from "remark-gfm"
import { api } from "./api"
import { discoverMachine, selectableMachineAgents } from "./machineClient"
import { taskClient, type MachineTask, type MachineTaskRun } from "./taskClient"
import type { MachineAgentHost, MessageEnvelope, ServerConfig } from "./types"
import { loadWorkspaceMachines, type WorkspaceMachine } from "./workspaceMachines"
import "./taskdesk-run-history.css"

const REVIEW_BUTTON_CLASS = "td3-run-review-button"
const ARCHIVE_ROOT_CLASS = "td3-run-archive-root"
const REMARK_PLUGINS = [remarkGfm]

type ResolvedRun = {
  machine: WorkspaceMachine
  task: MachineTask
  run: MachineTaskRun
  agent: MachineAgentHost
  config: ServerConfig
  index: number
}

type NumberedRun = MachineTaskRun & { sequence?: number }

let archiveRoot: Root | null = null
let archiveHost: HTMLElement | null = null

function supportedBackend(value: string, fallback: ServerConfig["backend"]): ServerConfig["backend"] {
  return value === "opencode" || value === "omp" || value === "pi" || value === "claude" || value === "codex"
    ? value
    : fallback
}

function runSessionID(run: MachineTaskRun): string | null {
  return run.sessionId || run.sessionID || null
}

function runHistory(task: MachineTask): MachineTaskRun[] {
  if (Array.isArray(task.runs) && task.runs.length) return task.runs
  return task.run ? [task.run] : []
}

function configForAgent(machine: WorkspaceMachine, agent: MachineAgentHost): ServerConfig {
  return {
    ...machine.config,
    backend: supportedBackend(agent.backend, machine.config.backend),
    agentId: agent.id
  }
}

function extractText(message: MessageEnvelope): string {
  return message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

async function resolveRun(sessionID: string): Promise<ResolvedRun> {
  const machines = loadWorkspaceMachines()
  for (const machine of machines) {
    let tasks: MachineTask[] = []
    try {
      tasks = await taskClient.listTasks(machine.config)
    } catch {
      continue
    }
    const task = tasks.find((candidate) => runHistory(candidate).some((run) => runSessionID(run) === sessionID))
    if (!task) continue
    const runs = runHistory(task)
    const index = runs.findIndex((run) => runSessionID(run) === sessionID)
    const run = runs[index]
    const snapshot = await discoverMachine(machine.config).catch(() => null)
    const agent = snapshot ? selectableMachineAgents(snapshot).find((candidate) => candidate.id === task.agentId) : undefined
    if (!agent) throw new Error(`Agent ${task.agentId} is not currently available on ${machine.name}`)
    return { machine, task, run, agent, config: configForAgent(machine, agent), index }
  }
  throw new Error("This Run is no longer present in the configured TaskDesk machines")
}

function ensureArchiveHost(): Root {
  if (archiveRoot && archiveHost) return archiveRoot
  archiveHost = document.createElement("div")
  archiveHost.className = ARCHIVE_ROOT_CLASS
  document.body.append(archiveHost)
  archiveRoot = createRoot(archiveHost)
  return archiveRoot
}

function closeArchive() {
  archiveRoot?.render(null)
  document.body.classList.remove("td3-run-archive-open")
}

function RunArchive({ resolved, messages }: { resolved: ResolvedRun; messages: MessageEnvelope[] }) {
  const sequence = (resolved.run as NumberedRun).sequence ?? resolved.index + 1
  const sessionID = runSessionID(resolved.run)
  return (
    <div className="td3-run-archive-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeArchive()
    }}>
      <section className="td3-run-archive" role="dialog" aria-modal="true" aria-label={`Run ${sequence} history`}>
        <header>
          <div>
            <small>Task history</small>
            <h2>Run #{sequence}</h2>
            <p>{resolved.run.prompt || resolved.task.prompt}</p>
          </div>
          <button type="button" onClick={closeArchive} aria-label="Close Run history">×</button>
        </header>
        <div className="td3-run-archive-meta">
          <span><small>Session</small><b>{sessionID || "Unknown"}</b></span>
          <span><small>Agent</small><b>{resolved.agent.label}</b></span>
          <span><small>Machine</small><b>{resolved.machine.name}</b></span>
          <span><small>Status</small><b>{resolved.run.finishedAt ? "Completed" : resolved.run.status || "Recorded"}</b></span>
        </div>
        <div className="td3-run-archive-body">
          {messages.length === 0 ? <div className="td3-run-archive-empty">No conversation is available for this Run.</div> : messages.map((message) => {
            const text = extractText(message)
            if (!text) return null
            return (
              <article key={message.info.id} className={message.info.role === "user" ? "user" : "assistant"}>
                <strong>{message.info.role === "user" ? "You" : resolved.agent.label}</strong>
                <div className="td3-markdown"><ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{text}</ReactMarkdown></div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

async function openRunArchive(sessionID: string) {
  const root = ensureArchiveHost()
  document.body.classList.add("td3-run-archive-open")
  root.render(
    <div className="td3-run-archive-backdrop">
      <section className="td3-run-archive loading" role="dialog" aria-modal="true">
        <div className="td3-run-archive-empty">Loading Run history...</div>
      </section>
    </div>
  )
  try {
    const resolved = await resolveRun(sessionID)
    const directory = resolved.run.directory || resolved.task.workspace.path
    const messages = await api.loadMessages(resolved.config, sessionID, directory)
    root.render(<RunArchive resolved={resolved} messages={messages} />)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    root.render(
      <div className="td3-run-archive-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeArchive()
      }}>
        <section className="td3-run-archive loading" role="dialog" aria-modal="true">
          <div className="td3-run-archive-empty error">{message}</div>
          <footer><button type="button" onClick={closeArchive}>Close</button></footer>
        </section>
      </div>
    )
  }
}

function sessionIDFromRunArticle(article: Element): string | null {
  for (const label of article.querySelectorAll("dt")) {
    if (label.textContent?.trim() !== "Session") continue
    const value = label.nextElementSibling?.textContent?.trim()
    return value && value !== "-" ? value : null
  }
  return null
}

function enhanceRunArticles() {
  for (const article of document.querySelectorAll(".td3-runs > article")) {
    if (article.querySelector(`.${REVIEW_BUTTON_CLASS}`)) continue
    const sessionID = sessionIDFromRunArticle(article)
    if (!sessionID) continue
    const content = article.querySelector(":scope > div") || article
    const button = document.createElement("button")
    button.type = "button"
    button.className = REVIEW_BUTTON_CLASS
    button.textContent = "Review Run"
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      void openRunArchive(sessionID)
    })
    content.append(button)
  }
}

/** Previous Task Runs remain durable product history. Enhance the Runs tab with an explicit review
 * action without adding any transcript polling: history is loaded only after the user asks for it. */
export function installTaskDeskRunHistory(): () => void {
  if (typeof document === "undefined") return () => undefined
  const observer = new MutationObserver(enhanceRunArticles)
  observer.observe(document.body, { childList: true, subtree: true })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && document.body.classList.contains("td3-run-archive-open")) closeArchive()
  }
  document.addEventListener("keydown", onKeyDown)
  enhanceRunArticles()
  return () => {
    observer.disconnect()
    document.removeEventListener("keydown", onKeyDown)
    closeArchive()
    archiveRoot?.unmount()
    archiveHost?.remove()
    archiveRoot = null
    archiveHost = null
  }
}
