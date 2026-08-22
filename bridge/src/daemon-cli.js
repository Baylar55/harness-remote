#!/usr/bin/env node
import path from "node:path"
import { AcpClient } from "./acp-client.js"
import { AcpAgentModelCatalog, HttpAgentModelCatalog } from "./agent-model-catalog.js"
import { parseDaemonOptions, daemonUsage } from "./daemon-options.js"
import { detectBackends, resolveLaunchPlan } from "./harness-detection.js"
import { harnessProfile, resolveAcpLaunch } from "./harness-profiles.js"
import { loadMachineIdentity } from "./machine-identity.js"
import { MachineDaemon, createMachineDaemonServer } from "./machine-daemon.js"
import { ManagedOpenCodeHost, ensureOpenCodePortAvailable } from "./opencode-host.js"

async function main() {
  let parsed
  try {
    parsed = parseDaemonOptions(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${daemonUsage()}\n`)
    process.exitCode = 1
    return
  }

  const { config, openCode, openCodeCommand, openCodeHost, openCodePort, openCodeTimeout } = parsed
  if (config.help) {
    process.stdout.write(`${daemonUsage()}\n`)
    return
  }

  if (openCode && openCodePort === config.port) {
    throw new Error(`OpenCode port ${openCodePort} conflicts with the Harness daemon port`)
  }
  if (openCode) await ensureOpenCodePortAvailable({ port: openCodePort, host: openCodeHost })

  const identity = await loadMachineIdentity(config.stateDirectory)
  const daemon = new MachineDaemon(identity)
  const plan = resolveLaunchPlan(process.argv.slice(2))
  const acpBackends = [...new Set([...plan.detected.filter((backend) => backend !== "opencode"), config.backend])]
  const primaryProfile = harnessProfile(config.backend)
  const acpHosts = new Map()
  for (const backend of acpBackends) {
    const profile = harnessProfile(backend)
    const launch = backend === config.backend
      ? { command: config.acpCommand, args: config.acpArgs }
      : resolveAcpLaunch(profile)
    const agentConfig = { ...config, backend: profile.id, acpCommand: launch.command, acpArgs: launch.args }
    const acp = new AcpClient({
      command: launch.command,
      args: launch.args,
      permissionMode: profile.permissionMode,
      preferredAuthMethod: profile.authMethod
    })
    // Model discovery owns a separate ACP connection and one durable prompt-less session. That keeps
    // New Task catalog refreshes from interfering with user-facing ACP session history.
    const modelCatalog = new AcpAgentModelCatalog({
      agent: new AcpClient({ command: launch.command, args: launch.args, permissionMode: profile.permissionMode, preferredAuthMethod: profile.authMethod }),
      agentID: profile.id,
      directory: config.roots?.[0] ?? process.cwd(),
      stateDirectory: config.stateDirectory,
      variantConfigIDs: profile.modelVariantConfigIDs
    })
    // Load persisted technical-session ids before the server starts, so they never leak into lists.
    await modelCatalog.preloadState()
    daemon.registerAcpHost({
      id: profile.id,
      label: profile.label,
      backend: profile.id,
      capabilities: profile.capabilities,
      agent: acp,
      modelCatalog,
      bridgeConfig: agentConfig,
      serviceOptions: {
        snapshotDirectory: path.join(config.stateDirectory, profile.id),
        historyLoader: profile.historyLoader,
        preserveListedTimestamps: profile.preserveListedTimestamps,
        hiddenSessionIDs: modelCatalog.hiddenSessionIDs,
        reloadOnHistoryRefresh: profile.reloadOnHistoryRefresh,
        replaySettleMs: profile.replaySettleMs
      }
    })
    acpHosts.set(profile.id, acp)
    acp.on("stderr", (line) => process.stderr.write(`[${profile.id}] ${line}\n`))
    acp.on("exit", (error) => process.stderr.write(`[${profile.id}] ${error.message}\n`))
  }
  const acp = acpHosts.get(primaryProfile.id)
  if (!acp) throw new Error(`Primary harness ${primaryProfile.id} was not detected`)

  if (openCode) {
    const managedOpenCode = new ManagedOpenCodeHost({
      command: openCodeCommand,
      host: openCodeHost,
      port: openCodePort,
      username: config.username,
      password: config.password,
      startTimeoutMs: openCodeTimeout
    })
    managedOpenCode.on("stderr", (line) => process.stderr.write(`[opencode] ${line}\n`))
    const openCodeModels = new HttpAgentModelCatalog({ host: managedOpenCode, agentID: "opencode" })
    // OpenCode is intentionally lazy like the ACP harnesses. Starting its Bun server during daemon
    // boot used resources before the user selected it and also surfaced upstream GlobalBus listener
    // warnings immediately. Model discovery, task launch, or a routed OpenCode request starts it on
    // first use through the host's idempotent start() path.
    daemon.registerManagedHttpHost({
      id: "opencode",
      label: "OpenCode",
      backend: "opencode",
      capabilities: {
        sessions: true,
        prompt: true,
        abort: true,
        streaming: true,
        agents: true,
        models: true,
        diff: true,
        todos: true,
        filesystemBrowser: true,
        questions: true,
        permissions: true,
        commands: true,
        actions: false,
        sessionRename: true,
        sessionDelete: true
      },
      host: managedOpenCode,
      modelCatalog: openCodeModels,
      eager: false
    })
  }

  const server = createMachineDaemonServer({
    daemon,
    config,
    primaryAcp: acp,
    primaryAgentID: primaryProfile.id,
    serviceOptions: {
      snapshotDirectory: path.join(config.stateDirectory, primaryProfile.id),
      historyLoader: primaryProfile.historyLoader,
      preserveListedTimestamps: primaryProfile.preserveListedTimestamps,
      hiddenSessionIDs: daemon.hostEntry(primaryProfile.id)?.modelCatalog?.hiddenSessionIDs,
      reloadOnHistoryRefresh: primaryProfile.reloadOnHistoryRefresh,
      replaySettleMs: primaryProfile.replaySettleMs
    }
  })

  server.listen(config.port, config.host, () => {
    const detected = detectBackends()
    process.stdout.write(`Harness Remote machine daemon\n`)
    process.stdout.write(`Listening on http://${config.host}:${config.port}\n`)
    process.stdout.write(`Machine: ${identity.name} (${identity.id})\n`)
    process.stdout.write(`Primary harness: ${primaryProfile.label}\n`)
    process.stdout.write(`Detected harnesses: ${detected.join(", ") || "none"}\n`)
  })

  const shutdown = () => {
    server.close(() => process.exit(0))
    daemon.close()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`)
  process.exitCode = 1
})
