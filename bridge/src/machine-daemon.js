import { createAgentRoutingServer } from "./agent-router.js"
import { createAgentModelServer } from "./agent-model-server.js"
import { MachineRegistry, trackAgentHostLifecycle } from "./machine-registry.js"
import { trackManagedHostLifecycle } from "./opencode-host.js"
import { discoverProjects } from "./project-catalog.js"
import { createBridgeServer } from "./server.js"
import { createSessionClaimServer } from "./session-claim-server.js"
import { createTaskFinishServer } from "./task-finish-server.js"
import { createTaskLaunchServer } from "./task-launch-server.js"
import { TaskLauncher } from "./task-launcher.js"
import { TaskRunController } from "./task-run-controller.js"
import { TaskRunStore } from "./task-run-store.js"
import { WorktreeManager } from "./worktree-manager.js"
import { WorkThreadController } from "./work-thread-controller.js"
import { createWorkThreadServer } from "./work-thread-server.js"

function daemonError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export class MachineDaemon {
  constructor(identity, { registry = new MachineRegistry(identity) } = {}) {
    this.registry = registry
    this.hosts = new Map()
  }

  registerAcpHost({ id, label, backend = id, capabilities = {}, contract = {}, agent, modelCatalog, bridgeConfig, serviceOptions, managed = true }) {
    this.registry.registerHost({ id, label, backend, transport: "acp", managed, state: "configured", capabilities, contract })
    const tracked = trackAgentHostLifecycle(agent, this.registry, id)
    this.hosts.set(id, { id, kind: "acp", host: tracked, modelCatalog, bridgeConfig, serviceOptions, eager: false })
    return tracked
  }

  registerManagedHttpHost({ id, label, backend = id, capabilities = {}, contract = {}, host, modelCatalog, managed = true, eager = true }) {
    this.registry.registerHost({ id, label, backend, transport: "http", managed, state: "configured", capabilities, contract })
    const tracked = trackManagedHostLifecycle(host, this.registry, id)
    this.hosts.set(id, { id, kind: "http", host: tracked, modelCatalog, eager })
    return tracked
  }

  hostEntry(id) { return this.hosts.get(id) }

  async listModels(id, options) {
    const entry = this.hostEntry(id)
    if (!entry) throw new Error(`Unknown agent: ${id}`)
    if (!entry.modelCatalog) throw new Error(`Agent ${id} does not expose model discovery`)
    return entry.modelCatalog.list(options)
  }

  modelDiagnostics(id, options) {
    const entry = this.hostEntry(id)
    if (!entry) return undefined
    return entry.modelCatalog?.diagnostics?.(options) ?? {
      source: "unavailable",
      cachedModels: 0,
      refreshedAt: null,
      ageMs: null,
      inFlight: false,
      lastAttemptAt: null,
      lastError: "Model discovery is not configured"
    }
  }

  async resolveModel(id, model, options) {
    if (!model) return null
    const entry = this.hostEntry(id)
    if (!entry) throw new Error(`Unknown agent: ${id}`)
    if (!entry.modelCatalog) throw new Error(`Agent ${id} does not expose model discovery`)
    if (typeof entry.modelCatalog.resolve === "function") return entry.modelCatalog.resolve(model, options)
    await entry.modelCatalog.validate(model, options)
    return model
  }

  async validateModel(id, model, options) {
    if (!model) return
    await this.resolveModel(id, model, options)
  }

  async startManagedHosts() {
    const eager = [...this.hosts.values()].filter((entry) => entry.eager)
    const settled = await Promise.allSettled(eager.map((entry) => entry.host.start()))
    return eager.map((entry, index) => settled[index].status === "fulfilled"
      ? { id: entry.id, status: "available" }
      : { id: entry.id, status: "unavailable", error: settled[index].reason })
  }

  snapshot() { return this.registry.snapshot() }

  diagnostics() {
    return {
      state: "running",
      machine: this.snapshot().machine,
      agents: this.snapshot().agents.map((agent) => {
        const entry = this.hostEntry(agent.id)
        return {
          ...agent,
          process: entry?.host?.diagnostics?.() ?? { processID: entry?.host?.processID },
          modelCatalog: entry?.modelCatalog?.diagnostics?.() ?? null
        }
      })
    }
  }

  close() {
    for (const entry of this.hosts.values()) {
      entry.modelCatalog?.close?.()
      if (entry.kind === "acp") entry.host.close?.()
      else entry.host.stop?.("SIGTERM")
    }
  }
}

export function createMachineDaemonServer({
  daemon,
  config,
  primaryAcp,
  primaryAgentID = config.backend,
  serviceOptions,
  createServer = createBridgeServer,
  createRouter = createAgentRoutingServer,
  createClaimServer = createSessionClaimServer,
  createModelServer = createAgentModelServer,
  createLaunchServer = createTaskLaunchServer,
  createFinishServer = createTaskFinishServer,
  createWorkThreadServerFactory = createWorkThreadServer,
  taskStore,
  projectCatalog,
  worktreeManager,
  taskLauncher,
  taskRunController,
  workThreadController
}) {
  const bridgeServer = createServer({ config, acp: primaryAcp, machineRegistry: daemon.registry, serviceOptions })
  const scopedAcpServers = new Map()
  const acpBridgeServer = (agentID) => {
    if (agentID === primaryAgentID) return bridgeServer
    const cached = scopedAcpServers.get(agentID)
    if (cached) return cached
    const entry = daemon.hostEntry(agentID)
    if (!entry || entry.kind !== "acp") return undefined
    const server = createServer({
      config: entry.bridgeConfig ?? { ...config, backend: agentID },
      acp: entry.host,
      machineRegistry: daemon.registry,
      serviceOptions: entry.serviceOptions
    })
    scopedAcpServers.set(agentID, server)
    return server
  }
  const machineID = daemon.snapshot().machine.id
  const roots = config.roots?.length ? config.roots : [process.cwd()]
  const stateDirectory = config.stateDirectory ?? process.cwd()
  const tasks = taskStore ?? new TaskRunStore({ machineID, stateDirectory })
  const projects = projectCatalog ?? (() => discoverProjects({ machineID, roots }))
  const worktrees = worktreeManager ?? new WorktreeManager({ stateDirectory })
  const acpService = (agentID) => {
    const server = agentID === primaryAgentID ? bridgeServer : acpBridgeServer(agentID)
    return server?.acpService
  }
  const claimSession = async (agentID, sessionID) => {
    const entry = daemon.hostEntry(agentID)
    if (!entry) throw daemonError("unknown_agent", `Unknown agent: ${agentID}`)
    if (entry.kind !== "acp") throw daemonError("unsupported_agent", `Agent ${agentID} does not require ACP Session claiming`)
    const service = acpService(agentID)
    if (!service) throw daemonError("session_unavailable", `Agent ${agentID} cannot load native Sessions`)
    // Compatibility implementation: models() already forces the exact existing Session through the
    // hardened ACP session/load path and propagates single-writer refusal. The HTTP/product contract
    // is now Session-specific, so extracting AcpService.claimSession later will not touch clients.
    await service.models(sessionID)
  }
  const launcher = taskLauncher ?? new TaskLauncher({ daemon, acpService })
  const runs = taskRunController ?? new TaskRunController({ taskStore: tasks, taskLauncher: launcher, acpService })
  const threads = workThreadController ?? new WorkThreadController({ taskStore: tasks, taskRunController: runs })
  const innerServer = createRouter({
    daemon,
    config,
    primaryAgentID,
    bridgeServer,
    acpBridgeServer,
    taskStore: tasks,
    projectCatalog: projects,
    worktreeManager: worktrees,
    diagnostics: () => ({
      ...daemon.diagnostics(),
      services: Object.fromEntries([
        [primaryAgentID, bridgeServer.acpService?.diagnostics?.()],
        ...[...scopedAcpServers.entries()].map(([agentID, server]) => [agentID, server.acpService?.diagnostics?.()])
      ].filter(([, value]) => value))
    })
  })
  const claimServer = createClaimServer({ innerServer, config, claimSession })
  const launchServer = createLaunchServer({ innerServer: claimServer, config, taskRunController: runs })
  const modelServer = createModelServer({ innerServer: launchServer, config, daemon, taskStore: tasks, projectCatalog: projects })
  const finishServer = createFinishServer({ innerServer: modelServer, config, taskStore: tasks, worktreeManager: worktrees, taskRunController: runs })
  return createWorkThreadServerFactory({ innerServer: finishServer, config, controller: threads })
}
