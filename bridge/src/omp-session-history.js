import { createReadStream } from "node:fs"
import { open, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"

const BACKWARD_READ_BYTES = 64 * 1024

function messageParts(content, messageID) {
  if (typeof content === "string") return [{ id: `${messageID}:text:0`, messageID, type: "text", text: content }]
  if (!Array.isArray(content)) return []
  return content.flatMap((item, index) => {
    if (item?.type === "text" && typeof item.text === "string" && item.text) {
      return [{ id: `${messageID}:text:${index}`, messageID, type: "text", text: item.text }]
    }
    if (item?.type === "thinking" && typeof item.thinking === "string" && item.thinking) {
      return [{ id: `${messageID}:reasoning:${index}`, messageID, type: "reasoning", text: item.thinking }]
    }
    // OMP stores what it re-encoded and keeps no filename, so the mime comes from the record
    // and the app renders the thumbnail without a label.
    if (item?.type === "image" && typeof item.data === "string" && item.data) {
      const mime = typeof item.mimeType === "string" && item.mimeType ? item.mimeType : "image/png"
      return [{
        id: `${messageID}:file:${index}`,
        messageID,
        type: "file",
        mime,
        url: `data:${mime};base64,${item.data}`
      }]
    }
    return []
  })
}

/**
 * A turn that failed is journalled as an assistant message with no content and the provider's own
 * sentence in `errorMessage`. Skipping those for having no parts made a rate-limited or unpaid
 * session look like it had simply lost its replies: the transcript showed the prompts and nothing
 * back, with no way to tell a failure from a missing message.
 */
function messageError(message) {
  const detail = typeof message?.errorMessage === "string" ? message.errorMessage.trim() : ""
  if (!detail) return undefined
  return { name: "HarnessTurnError", message: detail }
}

function messageEnvelope(record, sessionID) {
  if (record?.type !== "message") return undefined
  const role = record.message?.role
  if (role !== "user" && role !== "assistant") return undefined
  const messageID = record.id
  if (typeof messageID !== "string") return undefined
  const parts = messageParts(record.message?.content, messageID)
  const error = messageError(record.message)
  if (parts.length === 0 && !error) return undefined
  const created = Date.parse(record.timestamp ?? "")
  return {
    info: {
      id: messageID,
      role,
      sessionID,
      time: { created: Number.isFinite(created) ? created : Date.now() },
      ...(error ? { error } : {})
    },
    parts
  }
}

function encodePageCursor(offset, target) {
  return Buffer.from(JSON.stringify({ offset, target }), "utf8").toString("base64url")
}

function decodePageCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"))
    if (!Number.isSafeInteger(parsed?.offset) || parsed.offset < 0 || typeof parsed?.target !== "string" || !parsed.target) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

function parseRecordBuffer(buffer) {
  if (buffer.length > 0 && buffer[buffer.length - 1] === 0x0d) buffer = buffer.subarray(0, -1)
  try {
    const record = JSON.parse(buffer.toString("utf8"))
    return record && typeof record === "object" ? record : undefined
  } catch {
    return undefined
  }
}

async function readOmpPage(file, sessionID, { limit = 100, before, activeSessionLeaf } = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100))
  if (activeSessionLeaf === null) return { messages: [], before: null, hasMore: false }
  if (activeSessionLeaf === undefined && !before) return undefined

  const handle = await open(file, "r")
  try {
    const { size } = await handle.stat()
    const decoded = before ? decodePageCursor(before) : undefined
    if (before && (!decoded || decoded.offset > size)) throw new Error("Invalid OMP history cursor")

    let cursor = decoded?.offset ?? size
    let target = decoded?.target ?? activeSessionLeaf
    let matchedTarget = false
    let carry = Buffer.alloc(0)
    const messages = []
    let resumeCursor = null
    let hasMore = false
    let done = false

    while (cursor > 0 && !done) {
      const start = Math.max(0, cursor - BACKWARD_READ_BYTES)
      const chunk = Buffer.allocUnsafe(cursor - start)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start)
      const data = carry.length > 0
        ? Buffer.concat([chunk.subarray(0, bytesRead), carry])
        : chunk.subarray(0, bytesRead)

      let lineEnd = data.length
      const visit = (line, offset) => {
        const record = parseRecordBuffer(line)
        if (!record || typeof record.id !== "string" || record.id !== target) return
        matchedTarget = true
        target = typeof record.parentId === "string" && record.parentId ? record.parentId : undefined
        const message = messageEnvelope(record, sessionID)
        if (message) {
          if (messages.length < boundedLimit) {
            messages.push(message)
            if (messages.length === boundedLimit && target) resumeCursor = encodePageCursor(offset, target)
          } else {
            hasMore = true
            done = true
          }
        }
        if (!target) done = true
      }

      for (let index = data.length - 1; index >= 0 && !done; index -= 1) {
        if (data[index] !== 0x0a) continue
        const lineStart = index + 1
        if (lineStart < lineEnd) visit(data.subarray(lineStart, lineEnd), start + lineStart)
        lineEnd = index
      }
      if (start === 0) {
        if (lineEnd > 0 && !done) visit(data.subarray(0, lineEnd), 0)
        carry = Buffer.alloc(0)
        cursor = 0
      } else {
        carry = lineEnd > 0 ? Buffer.from(data.subarray(0, lineEnd)) : Buffer.alloc(0)
        cursor = start
      }
    }

    if (!matchedTarget) {
      if (before) throw new Error("Invalid OMP history cursor")
      throw new Error("OMP active session leaf is missing from transcript")
    }
    return {
      messages: messages.slice(0, boundedLimit).reverse(),
      before: hasMore ? resumeCursor : null,
      hasMore
    }
  } finally {
    await handle.close()
  }
}

export function createOmpHistoryLoader(
  sessionRoot = path.join(homedir(), ".omp", "agent", "sessions"),
  { readDirectory = readdir } = {}
) {
  const sessionFiles = new Map()
  let indexedFiles = null
  let indexInFlight = null

  async function refreshSessionIndex() {
    if (indexInFlight) return indexInFlight
    const operation = (async () => {
      try {
        const entries = await readDirectory(sessionRoot, { recursive: true, withFileTypes: true })
        indexedFiles = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
          .map((entry) => ({
            name: entry.name,
            file: path.join(entry.parentPath ?? entry.path, entry.name)
          }))
      } catch (error) {
        if (error?.code === "ENOENT") {
          indexedFiles = []
          return
        }
        throw error
      }
    })()
    indexInFlight = operation
    try {
      await operation
    } finally {
      if (indexInFlight === operation) indexInFlight = null
    }
  }

  function indexedSessionFile(sessionID) {
    const suffix = `_${sessionID}.jsonl`
    return indexedFiles?.find((entry) => entry.name.endsWith(suffix))?.file
  }

  async function locateSession(sessionID) {
    const known = sessionFiles.get(sessionID)
    if (known) return known
    if (!/^[A-Za-z0-9_-]+$/.test(sessionID)) return undefined

    if (indexedFiles === null) await refreshSessionIndex()
    let file = indexedSessionFile(sessionID)
    if (!file) {
      // A miss can mean OMP created this Session after the first index build. Refresh once rather
      // than making every different historical Session recursively scan the full journal tree.
      await refreshSessionIndex()
      file = indexedSessionFile(sessionID)
    }
    if (!file) return undefined
    sessionFiles.set(sessionID, file)
    return file
  }

  const loadOmpHistory = async function loadOmpHistory(sessionID, { activeSessionLeaf } = {}) {
    // JSONL is append-only: its final record may belong to an abandoned branch.
    // Without an authoritative selected leaf, ACP replay is safer than guessing.
    if (activeSessionLeaf === undefined) return []
    const file = await locateSession(sessionID)
    if (!file) return []
    const records = []
    const entries = new Map()
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    for await (const line of lines) {
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof record?.id === "string") {
        records.push(record)
        entries.set(record.id, record)
      }
    }

    const selected = []
    if (activeSessionLeaf === null) {
      // The extension selected the session root.
    } else if (entries.has(activeSessionLeaf)) {
      const branch = []
      const visited = new Set()
      let entry = entries.get(activeSessionLeaf)
      while (entry && !visited.has(entry.id)) {
        visited.add(entry.id)
        branch.push(entry)
        entry = typeof entry.parentId === "string" ? entries.get(entry.parentId) : undefined
      }
      selected.push(...branch.reverse())
    } else {
      throw new Error("OMP active session leaf is missing from transcript")
    }

    return selected.flatMap((record) => {
      const message = messageEnvelope(record, sessionID)
      return message ? [message] : []
    })
  }

  loadOmpHistory.pageRequiresActiveLeaf = true
  loadOmpHistory.page = async (sessionID, options = {}) => {
    const file = await locateSession(sessionID)
    if (!file) return { messages: [], before: null, hasMore: false }
    return readOmpPage(file, sessionID, options)
  }

  return loadOmpHistory
}
