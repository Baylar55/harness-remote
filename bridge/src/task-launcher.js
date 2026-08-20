import { taskLaunchError } from "./task-errors.js"
import { promptModelBody } from "./task-model.js"

function basicAuthorization(username, password) {
  if (!username && !password) return undefined
  return `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}`
}

function httpHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

async function responseJSON(response, label) {
  if (!response.ok) {
    let detail = ""
    try {
      const body = await response.json()
      detail = typeof body?.error === "string" ? `: ${body.error}` : ""
    } catch {}
    throw new Error(`${label} failed with HTTP ${response.status}${detail}`)
  }
  return response.json()
}

function openCodeStatus(value) {
  const type = typeof value === "string" ? value : value?.type
  if (type === "idle") return "completed"
  if (type === "busy" || type === "retry") return "running"
  return "unknown"
}

function acpModelValue(configOptions, model) {
  if (!model) return undefined
  const option = configOptions?.find((item) => item.id === "model")
  const qualified = `${model.providerID}/${model.modelID}`
  if (option?.options?.some((candidate) => candidate.value === qualified)) return qualified
  return option?.options?.find((candidate) => candidate.value === model.modelID)?.value
}

function acpModelWireName(model) {
  return model ? `${model.providerID}/${model.modelID}` : undefined
}

function runAgentID(task, run = task?.run) {
  return run?.agentId || task?.agentId
}

function runModel(task, run = task?.run) {
  return run?.model ?? task?.model ?? null
}

function taskSessionTitle(task) {
  const base = `Task ${task.id.slice(0, 8)}`
  return Number(task.run?.sequence) > 1 ? `${base} · Run ${task.run.sequence}` : base
}

export class TaskLauncher {
  constructor({ daemon, fetchImpl = fetch, acpService } = {}) {
    this.daemon = daemon
    this.fetchImpl = fetchImpl
    this.acpService = acpService
  }

  async #entry(agentID) {
    const entry = this.daemon.hostEntry(agentID)
    if (!entry) throw taskLaunchError("unknown_agent", `Unknown agent: ${agentID}`)
    if (this.daemon.registry.host(agentID)?.state === "unavailable") {
      throw taskLaunchError("agent_unavailable", `Agent ${agentID} is unavailable`)
    }
    return entry
  }

  async createSession(task) {
    const agentID = runAgentID(task)
    const model = runModel(task)
    const entry = await this.#entry(agentID)
    if (!task.workspace?.path) throw taskLaunchError("workspace_required", "Task workspace is not prepared")
    const title = taskSessionTitle(task)

    if (entry.kind === "acp") {
      const service = this.acpService?.(agentID)
      if (service) {
        const session = await service.createSession({
          directory: task.workspace.path,
          title,
          model: acpModelWireName(model)
        })
        if (!session?.id) throw new Error(`Agent ${agentID} did not return a session id`)
        return { sessionId: session.id, transport: "acp", directory: task.workspace.path }
      }
      await entry.host.start()
      const result = await entry.host.request("session/new", { cwd: task.workspace.path, mcpServers: [] })
      if (!result?.sessionId) throw new Error(`Agent ${agentID} did not return a session id`)
      const value = acpModelValue(result.configOptions, model)
      if (value) {
        await entry.host.request("session/set_config_option", {
          sessionId: result.sessionId,
          configId: "model",
          value
        })
      }
      return { sessionId: result.sessionId, transport: "acp", directory: task.workspace.path }
    }

    if (entry.kind === "http") {
      await entry.host.start?.()
      const host = entry.host.readinessHost ?? entry.host.host ?? "127.0.0.1"
      const base = `http://${httpHost(host)}:${entry.host.port}`
      const authorization = basicAuthorization(entry.host.username, entry.host.password)
      const response = await this.fetchImpl(`${base}/session?directory=${encodeURIComponent(task.workspace.path)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {})
        },
        body: JSON.stringify({
          title
        })
      })
      const session = await responseJSON(response, `Creating ${agentID} session`)
      if (!session?.id) throw new Error(`Agent ${agentID} did not return a session id`)
      return { sessionId: session.id, transport: "http", directory: task.workspace.path, base, authorization }
    }

    throw taskLaunchError("unsupported_agent", `Agent ${agentID} cannot launch tasks`)
  }

  async resumeSession(task, previousRun) {
    const agentID = runAgentID(task)
    const model = runModel(task)
    if (!previousRun?.sessionId) throw taskLaunchError("session_unavailable", "The previous Task session is unavailable")
    if (previousRun.agentId && previousRun.agentId !== agentID) {
      throw taskLaunchError("session_unavailable", "A native Session can only be resumed by the harness that owns it")
    }
    const entry = await this.#entry(agentID)
    if (!task.workspace?.path) throw taskLaunchError("workspace_required", "Task workspace is not prepared")

    if (entry.kind === "acp") {
      const service = this.acpService?.(agentID)
      if (service) {
        const adopted = await service.adoptTaskSession(previousRun.sessionId, { title: taskSessionTitle(task) })
        if (adopted === false) throw taskLaunchError("session_unavailable", "The previous native Session can no longer be resumed")
        if (model) await service.setModel(previousRun.sessionId, acpModelWireName(model))
        return { sessionId: previousRun.sessionId, transport: "acp", directory: task.workspace.path }
      }
      await entry.host.start()
      if (model) {
        await entry.host.request("session/set_config_option", {
          sessionId: previousRun.sessionId,
          configId: "model",
          value: acpModelWireName(model)
        })
      }
      return { sessionId: previousRun.sessionId, transport: "acp", directory: task.workspace.path }
    }

    if (entry.kind === "http") {
      await entry.host.start?.()
      const host = entry.host.readinessHost ?? entry.host.host ?? "127.0.0.1"
      const base = `http://${httpHost(host)}:${entry.host.port}`
      const authorization = basicAuthorization(entry.host.username, entry.host.password)
      return { sessionId: previousRun.sessionId, transport: "http", directory: task.workspace.path, base, authorization }
    }

    throw taskLaunchError("unsupported_agent", `Agent ${agentID} cannot resume tasks`)
  }

  async startPrompt(task, run, { onFailed, onCompleted } = {}) {
    const agentID = runAgentID(task, run)
    const model = runModel(task, run)
    const entry = await this.#entry(agentID)

    if (entry.kind === "acp") {
      const service = this.acpService?.(agentID)
      if (service) {
        void service.promptAndWait(run.sessionId, task.prompt).then((result) => {
          onCompleted?.(result)
        }).catch((error) => {
          onFailed?.(error)
        })
        return
      }
      void entry.host.request("session/prompt", {
        sessionId: run.sessionId,
        prompt: [{ type: "text", text: task.prompt }]
      }, 300_000).then((result) => {
        onCompleted?.(result)
      }).catch((error) => {
        onFailed?.(error)
      })
      return
    }

    if (entry.kind === "http") {
      void this.fetchImpl(`${run.base}/session/${encodeURIComponent(run.sessionId)}/message?directory=${encodeURIComponent(task.workspace.path)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(run.authorization ? { Authorization: run.authorization } : {})
        },
        body: JSON.stringify({
          parts: [{ type: "text", text: task.prompt }],
          model: promptModelBody(model),
          variant: model?.variant || undefined
        })
      }).then((response) => responseJSON(response, `Starting ${agentID} task`))
        .then((result) => onCompleted?.(result))
        .catch((error) => onFailed?.(error))
    }
  }

  async inspectRun(task) {
    const run = task?.run
    if (!run?.sessionId) return "unknown"
    const agentID = runAgentID(task, run)
    const entry = this.daemon.hostEntry(agentID)
    if (!entry) return "unknown"

    if (entry.kind === "acp") return "unknown"
    if (entry.kind !== "http") return "unknown"

    try {
      await entry.host.start?.()
      const host = entry.host.readinessHost ?? entry.host.host ?? "127.0.0.1"
      const base = `http://${httpHost(host)}:${entry.host.port}`
      const authorization = basicAuthorization(entry.host.username, entry.host.password)
      const response = await this.fetchImpl(`${base}/session/status?directory=${encodeURIComponent(task.workspace?.path ?? run.directory ?? "")}`, {
        headers: authorization ? { Authorization: authorization } : {}
      })
      if (!response.ok) return "unknown"
      const statuses = await response.json()
      return openCodeStatus(statuses?.[run.sessionId])
    } catch {
      return "unknown"
    }
  }
}
