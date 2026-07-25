import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"

const START_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 30_000

export class AcpClient extends EventEmitter {
  #ompBin
  #spawn
  #child
  #buffer = ""
  #nextID = 1
  #pending = new Map()
  #starting
  #agentInfo

  constructor({ ompBin = "omp", spawnProcess = spawn } = {}) {
    super()
    this.#ompBin = ompBin
    this.#spawn = spawnProcess
  }

  get agentInfo() {
    return this.#agentInfo
  }


  async start() {
    if (this.#child) return
    if (this.#starting) return this.#starting
    this.#starting = this.#start()
    try {
      await this.#starting
    } finally {
      this.#starting = undefined
    }
  }

  async #start() {
    const child = this.#spawn(this.#ompBin, ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    })
    this.#child = child
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => this.#consume(chunk))
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk))
    child.on("error", (error) => this.#handleExit(error))
    child.on("exit", (code, signal) => {
      this.#handleExit(new Error(`OMP ACP exited (${code ?? "unknown"}${signal ? `, ${signal}` : ""})`))
    })

    try {
      const initialized = await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "harness-remote-omp", version: "0.1.7" }
      }, START_TIMEOUT_MS)
      this.#agentInfo = initialized.agentInfo
      const authMethod = initialized.authMethods?.find((method) => method.id === "agent")
      if (!authMethod) throw new Error("OMP ACP does not offer local agent authentication")
      await this.request("authenticate", { methodId: authMethod.id }, START_TIMEOUT_MS)
    } catch (error) {
      this.close()
      throw error
    }
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!this.#child || this.#child.killed || !this.#child.stdin.writable) {
      return Promise.reject(new Error("OMP ACP is not running"))
    }
    const id = this.#nextID++
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`OMP ACP request timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      this.#child.stdin.write(`${message}\n`, (error) => {
        if (!error) return
        const pending = this.#pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        pending.reject(error)
      })
    })
  }
  notify(method, params) {
    if (!this.#child || this.#child.killed || !this.#child.stdin.writable) {
      throw new Error("OMP ACP is not running")
    }
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
  }


  async listSessions() {
    await this.start()
    const result = await this.request("session/list", {})
    return result.sessions ?? []
  }


  close() {
    const child = this.#child
    this.#child = undefined
    if (child && !child.killed) child.kill()
    this.#rejectPending(new Error("OMP ACP closed"))
  }

  #consume(chunk) {
    this.#buffer += chunk
    let boundary = this.#buffer.indexOf("\n")
    while (boundary !== -1) {
      const line = this.#buffer.slice(0, boundary).trim()
      this.#buffer = this.#buffer.slice(boundary + 1)
      if (line) this.#consumeMessage(line)
      boundary = this.#buffer.indexOf("\n")
    }
  }

  #consumeMessage(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this.emit("protocol-error", new Error("OMP ACP emitted invalid JSON"))
      return
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? "OMP ACP request failed"))
      else pending.resolve(message.result)
      return
    }
    if (message.method) this.emit("notification", message)
  }

  #handleExit(error) {
    if (!this.#child) return
    this.#child = undefined
    this.#rejectPending(error)
    this.emit("exit", error)
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
