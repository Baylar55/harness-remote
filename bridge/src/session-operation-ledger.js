import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const VERSION = 1
const MAX_OPERATIONS = 1024

function ledgerError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function operationKey(agentID, sessionID, clientRequestId) {
  return `${agentID}\u0000${sessionID}\u0000${clientRequestId}`
}

/**
 * Durable idempotency ledger for user-visible native Session mutations.
 *
 * Pending is persisted before a mutation is dispatched. Accepted is persisted before the HTTP
 * success is returned. After a daemon restart a pending/uncertain entry is deliberately not replayed:
 * it is safer to ask the client to reconcile the native Session than to repeat coding work or a
 * lifecycle mutation whose first delivery may already have succeeded.
 */
export class SessionOperationLedger {
  #machineID
  #stateDirectory
  #path
  #loaded = false
  #operations = new Map()
  #mutation = Promise.resolve()

  constructor({ machineID, stateDirectory }) {
    this.#machineID = machineID
    this.#stateDirectory = stateDirectory
    this.#path = path.join(stateDirectory, "session-operations.json")
  }

  async #load() {
    if (this.#loaded) return
    this.#loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"))
      if (parsed?.version !== VERSION || parsed?.machineID !== this.#machineID || !Array.isArray(parsed.operations)) return
      for (const entry of parsed.operations) {
        if (!entry || typeof entry !== "object") continue
        if (!["pending", "accepted", "uncertain"].includes(entry.state)) continue
        if (![entry.agentID, entry.sessionID, entry.clientRequestId, entry.signature].every((value) => typeof value === "string" && value)) continue
        this.#operations.set(operationKey(entry.agentID, entry.sessionID, entry.clientRequestId), entry)
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw ledgerError("operation_ledger_unreadable", "Native Session operation ledger is unreadable")
    }
  }

  #trim() {
    if (this.#operations.size <= MAX_OPERATIONS) return
    const accepted = [...this.#operations.entries()]
      .filter(([, entry]) => entry.state === "accepted")
      .sort(([, left], [, right]) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
    while (this.#operations.size > MAX_OPERATIONS && accepted.length) {
      const [key] = accepted.shift()
      this.#operations.delete(key)
    }
  }

  async #persist() {
    this.#trim()
    await mkdir(this.#stateDirectory, { recursive: true })
    const payload = JSON.stringify({
      version: VERSION,
      machineID: this.#machineID,
      operations: [...this.#operations.values()]
    })
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, payload, { mode: 0o600 })
    await rename(temporary, this.#path)
  }

  #serial(operation) {
    const next = this.#mutation.then(operation, operation)
    this.#mutation = next.catch(() => undefined)
    return next
  }

  async begin({ agentID, sessionID, clientRequestId, signature }) {
    return this.#serial(async () => {
      await this.#load()
      const key = operationKey(agentID, sessionID, clientRequestId)
      const existing = this.#operations.get(key)
      if (existing) {
        if (existing.signature !== signature) {
          throw ledgerError("idempotency_conflict", "clientRequestId was already used for a different native Session operation")
        }
        return { duplicate: true, state: existing.state, entry: { ...existing } }
      }
      const now = new Date().toISOString()
      const entry = {
        agentID,
        sessionID,
        clientRequestId,
        signature,
        state: "pending",
        createdAt: now,
        updatedAt: now
      }
      this.#operations.set(key, entry)
      await this.#persist()
      return { duplicate: false, state: entry.state, entry: { ...entry } }
    })
  }

  async accept({ agentID, sessionID, clientRequestId }) {
    return this.#serial(async () => {
      await this.#load()
      const key = operationKey(agentID, sessionID, clientRequestId)
      const entry = this.#operations.get(key)
      if (!entry) throw ledgerError("operation_missing", "Native Session operation is missing")
      entry.state = "accepted"
      entry.updatedAt = new Date().toISOString()
      await this.#persist()
      return { ...entry }
    })
  }

  async fail({ agentID, sessionID, clientRequestId, ambiguous = false }) {
    return this.#serial(async () => {
      await this.#load()
      const key = operationKey(agentID, sessionID, clientRequestId)
      const entry = this.#operations.get(key)
      if (!entry) return
      if (ambiguous) {
        entry.state = "uncertain"
        entry.updatedAt = new Date().toISOString()
      } else {
        this.#operations.delete(key)
      }
      await this.#persist()
    })
  }

  async get({ agentID, sessionID, clientRequestId }) {
    await this.#load()
    const entry = this.#operations.get(operationKey(agentID, sessionID, clientRequestId))
    return entry ? { ...entry } : undefined
  }
}
