import { execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const gate = path.join(here, "native-opencode-live-zen-release-gate.mjs")

function snapshot() {
  if (process.platform === "win32") return "process topology watch is POSIX-only"
  try {
    const output = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,sid=,stat=,comm=,args="], { encoding: "utf8" })
    return output
      .split(/\r?\n/)
      .filter((line) => /(?:opencode|daemon-cli\.js)/i.test(line) && !/native-opencode-process-watch/i.test(line))
      .join("\n")
      .trim() || "<no managed OpenCode/daemon process>"
  } catch (error) {
    return `<ps failed: ${error instanceof Error ? error.message : String(error)}>`
  }
}

let prior = ""
function report(label = "change") {
  const current = snapshot()
  if (label !== "change" || current !== prior) {
    console.log(`process-watch ${label}:\n${current}`)
    prior = current
  }
}

report("initial")
const child = spawn(process.execPath, [gate], {
  cwd: path.join(here, ".."),
  env: process.env,
  stdio: "inherit"
})
const timer = setInterval(() => report(), 1_000)
timer.unref()

child.once("exit", (code, signal) => {
  clearInterval(timer)
  report("final")
  if (signal) {
    console.error(`process-watch: release gate exited by ${signal}`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})
