import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createOmpUndoRedoActionStateLoader } from "../src/omp-extension-action-state.js"

const sessionID = "session-1"
const sessionHash = createHash("sha256").update(sessionID).digest("hex")

test("normalizes the omp-undo-redo navigation store into authoritative action state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-actions-"))
  const historyDirectory = path.join(root, "omp-undo-redo", "history")
  const statePath = path.join(historyDirectory, `${sessionHash}.json`)
  await mkdir(historyDirectory, { recursive: true })
  const loadState = createOmpUndoRedoActionStateLoader({
    runGit: async () => ({ stdout: `${root}\n` })
  })

  try {
    const checkpoints = [
      { kind: "session", parentLeafId: "user-1", leafId: "assistant-1" },
      { kind: "session", parentLeafId: "user-2", leafId: "assistant-2" }
    ]
    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, sessionHash, checkpoints, currentIndex: 1 }))
    assert.deepEqual(await loadState({ sessionID, directory: root }), {
      actions: [{ id: "undo", enabled: true }, { id: "redo", enabled: false }],
      sessionRevision: "1:assistant-2",
      activeSessionLeaf: "assistant-2"
    })

    await writeFile(statePath, JSON.stringify({ schemaVersion: 1, sessionHash, checkpoints, currentIndex: 0 }))
    assert.deepEqual(await loadState({ sessionID, directory: root }), {
      actions: [{ id: "undo", enabled: true }, { id: "redo", enabled: true }],
      sessionRevision: "0:assistant-1",
      activeSessionLeaf: "assistant-1"
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("accepts the normalized optional action protocol with an explicit invocation result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harness-remote-omp-actions-"))
  const historyDirectory = path.join(root, "omp-undo-redo", "history")
  await mkdir(historyDirectory, { recursive: true })
  await writeFile(path.join(historyDirectory, `${sessionHash}.json`), JSON.stringify({
    actions: [{ id: "undo", enabled: false }, { id: "redo", enabled: true }],
    sessionRevision: "revision-2",
    activeSessionLeaf: "user-1",
    actionResult: { id: "undo", applied: false, token: "action-2" }
  }))
  const loadState = createOmpUndoRedoActionStateLoader({ runGit: async () => ({ stdout: root }) })

  try {
    assert.deepEqual(await loadState({ sessionID, directory: root }), {
      actions: [{ id: "undo", enabled: false }, { id: "redo", enabled: true }],
      sessionRevision: "revision-2",
      activeSessionLeaf: "user-1",
      actionResult: { id: "undo", applied: false, token: "action-2" }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
