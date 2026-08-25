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

/*
 * How long a directory listing may be reused before another lookup miss rescans.
 *
 * Short enough that a Session created moments ago is still found, long enough that opening many
 * Sessions in a row does not walk the tree once per Session.
 */
const OMP_SESSION_LISTING_TTL_MS = 1_000

export function createOmpHistoryLoader(sessionRoot = path.join(homedir(), ".omp", "agent", "sessions")) {
  const sessionFiles = new Map()
  let listing = []
  let listedAt = 0
  let listingInFlight
  let listingScans = 0

  /*
   * The recursive walk already enumerates every Session file, so keep what it read.
   *
   * Discarding it meant each new Session opened paid its own full walk of the OMP session tree, so a
   * machine with a lot of history spent O(Sessions) tree walks just to find files it had already
   * seen - which is what made opening Sessions progressively slower. The listing is retained instead
   * and searched in memory; only a miss against a stale listing walks the tree again.
   *
   * Session ids may themselves contain underscores, so files are matched by suffix rather than by
   * trying to recover an id from a file name.
   */
  async function refreshListing() {
    if (listingInFlight) return listingInFlight
    listingInFlight = (async () => {
      try {
        listingScans += 1
        const entries = await readdir(sessionRoot, { recursive: true, withFileTypes: true })
        listing = entries
          .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".jsonl"))
          .map((candidate) => ({ name: candidate.name, file: path.join(candidate.parentPath ?? candidate.path, candidate.name) }))
        listedAt = Date.now()
      } catch (error) {
        if (error?.code === "ENOENT") {
          listing = []
          listedAt = Date.now()
          return
        }
        throw error
      } finally {
        listingInFlight = undefined
      }
    })()
    return listingInFlight
  }

  async function locateSession(sessionID) {
    const known = sessionFiles.get(sessionID)
    if (known) return known
    if (!/^[A-Za-z0-9_-]+$/.test(sessionID)) return undefined
    const suffix = `_${sessionID}.jsonl`
    const find = () => listing.find((candidate) => candidate.name.endsWith(suffix))?.file

    let file = find()
    if (!file && Date.now() - listedAt >= OMP_SESSION_LISTING_TTL_MS) {
      await refreshListing()
      file = find()
    }
    if (!file) return undefined
    sessionFiles.set(sessionID, file)
    return file
  }

  const loadOmpHistory = async function loadOmpHistory(sessionID, { activeSessionLeaf } = {}) {
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
    let selectedLeaf = activeSessionLeaf
    if (selectedLeaf === undefined) {
      // The extension is optional.  A transcript with one terminal leaf is not
      // ambiguous, so use it instead of issuing a blocking ACP session/load.
      // Multiple leaves still require the extension's authoritative selection.
      const parents = new Set(records.map((record) => record.parentId).filter((parentID) => typeof parentID === "string" && parentID))
      const leaves = records.map((record) => record.id).filter((id) => !parents.has(id))
      if (leaves.length !== 1) return []
      selectedLeaf = leaves[0]
    }
    if (selectedLeaf === null) {
      // The extension selected the session root.
    } else if (entries.has(selectedLeaf)) {
      const branch = []
      const visited = new Set()
      let entry = entries.get(selectedLeaf)
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

  /** How often the session tree was walked, and how many files that walk is currently serving. */
  loadOmpHistory.diagnostics = () => ({
    source: "omp-session-jsonl",
    listingScans,
    listedFiles: listing.length,
    resolvedSessions: sessionFiles.size,
    listingAgeMs: listedAt ? Date.now() - listedAt : null
  })
  loadOmpHistory.pageRequiresActiveLeaf = true
  // Without an extension-published leaf, a journal branch is ambiguous.  Do not
  // turn a read-only open into an ACP session/load just to guess it: external
  // attachment-only Sessions otherwise stall the whole OMP adapter.
  loadOmpHistory.deferAcpReplayWithoutActiveLeaf = true
  loadOmpHistory.page = async (sessionID, options = {}) => {
    const file = await locateSession(sessionID)
    if (!file) return { messages: [], before: null, hasMore: false }
    return readOmpPage(file, sessionID, options)
  }

  return loadOmpHistory
}
