#!/usr/bin/env node
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const daemonCli = fileURLToPath(new URL("./daemon-cli.js", import.meta.url))
const child = spawn(process.execPath, [daemonCli, ...process.argv.slice(2)], {
  stdio: "inherit"
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
