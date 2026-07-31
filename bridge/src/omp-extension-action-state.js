import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const ACTION_IDS = new Set(["undo", "redo"])

function sessionHash(sessionID) {
  return createHash("sha256").update(sessionID).digest("hex")
}

function normalizeProtocolState(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.actions)) return undefined
  if (typeof value.sessionRevision !== "string") return undefined
  const actions = value.actions.flatMap((action) => (
    ACTION_IDS.has(action?.id) && typeof action.enabled === "boolean"
      ? [{ id: action.id, enabled: action.enabled }]
      : []
  ))
  if (actions.length !== ACTION_IDS.size) return undefined
  const actionResult = value.actionResult &&
    ACTION_IDS.has(value.actionResult.id) &&
    typeof value.actionResult.applied === "boolean" &&
    typeof value.actionResult.token === "string"
    ? { id: value.actionResult.id, applied: value.actionResult.applied, token: value.actionResult.token }
    : undefined
  return {
    actions,
    sessionRevision: value.sessionRevision,
    activeSessionLeaf: value.activeSessionLeaf === null || typeof value.activeSessionLeaf === "string"
      ? value.activeSessionLeaf
      : undefined,
    actionResult
  }
}

function normalizeLegacyHistory(value, expectedHash) {
  if (value?.schemaVersion !== 1 || value.sessionHash !== expectedHash || !Array.isArray(value.checkpoints)) return undefined
  const currentIndex = value.currentIndex
  if (!Number.isInteger(currentIndex) || currentIndex < -1 || currentIndex >= value.checkpoints.length) return undefined
  if (value.checkpoints.length === 0) return undefined
  const activeSessionLeaf = currentIndex >= 0
    ? value.checkpoints[currentIndex]?.leafId
    : value.checkpoints[0]?.parentLeafId
  if (activeSessionLeaf !== null && typeof activeSessionLeaf !== "string") return undefined
  return {
    actions: [
      { id: "undo", enabled: currentIndex >= 0 },
      { id: "redo", enabled: currentIndex < value.checkpoints.length - 1 }
    ],
    sessionRevision: `${currentIndex}:${activeSessionLeaf ?? "root"}`,
    activeSessionLeaf
  }
}

/**
 * Reads the optional state contract published by omp-undo-redo. Schema 1 is the
 * extension's durable navigation store; newer publishers may expose the small
 * normalized actions/sessionRevision contract directly in the same sidecar.
 */
export function createOmpUndoRedoActionStateLoader({ runGit = execFileAsync } = {}) {
  const commonDirectories = new Map()

  async function resolveCommonDirectory(directory) {
    let loading = commonDirectories.get(directory)
    if (!loading) {
      loading = runGit("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024
      }).then(({ stdout }) => stdout.trim())
      commonDirectories.set(directory, loading)
    }
    try {
      const commonDirectory = await loading
      if (!commonDirectory) commonDirectories.delete(directory)
      return commonDirectory
    } catch (error) {
      commonDirectories.delete(directory)
      throw error
    }
  }

  return async function loadOmpUndoRedoActionState({ sessionID, directory }) {
    if (!sessionID || !directory) return undefined
    try {
      const commonDirectory = await resolveCommonDirectory(directory)
      if (!commonDirectory) return undefined
      const expectedHash = sessionHash(sessionID)
      const statePath = path.join(commonDirectory, "omp-undo-redo", "history", `${expectedHash}.json`)
      const value = JSON.parse(await readFile(statePath, "utf8"))
      return normalizeProtocolState(value) ?? normalizeLegacyHistory(value, expectedHash)
    } catch {
      return undefined
    }
  }
}
