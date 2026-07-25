#!/usr/bin/env node
import { AcpClient } from "./acp-client.js"
import { parseConfig, usage } from "./config.js"
import { createBridgeServer } from "./server.js"

let config
try {
  config = parseConfig(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}\n`)
  process.exitCode = 1
}

if (config?.help) {
  process.stdout.write(`${usage()}\n`)
  process.exit(0)
}

if (config) {
  const acp = new AcpClient({ ompBin: config.ompBin })
  const server = createBridgeServer({ config, acp })
  let shuttingDown = false

  acp.on("stderr", (line) => process.stderr.write(`[omp] ${line}`))
  acp.on("agent-request", (message) => {
    process.stderr.write(`[omp] declined unsupported agent request: ${message.method}\n`)
  })
  acp.on("exit", (error) => {
    if (!shuttingDown) process.stderr.write(`[omp] ${error.message}\n`)
  })

  server.listen(config.port, config.host, () => {
    process.stdout.write(`OMP bridge listening on http://${config.host}:${config.port}\n`)
  })

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    acp.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5_000).unref()
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}
