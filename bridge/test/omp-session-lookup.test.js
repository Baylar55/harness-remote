import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createOmpHistoryLoader } from "../src/omp-session-history.js"

/*
 * Locating an OMP Session walks the session tree recursively. The walk already enumerates every
 * Session file, so opening many Sessions must not repeat it once per Session: on a machine with a
 * lot of OMP history that is what made each successive Session open slower than the last.
 */
async function tree(sessionCount, { depth = 3 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "omp-sessions-"))
  const ids = []
  for (let index = 0; index < sessionCount; index += 1) {
    // Ids may legitimately contain underscores, which is why files are matched by suffix.
    const id = `sess_${index}_${index % 7}`
    ids.push(id)
    const dir = path.join(root, ...Array.from({ length: depth }, (_, level) => `d${level}-${index % (level + 2)}`))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `2026-08-25T10-00-00_${id}.jsonl`), "")
  }
  return { root, ids }
}

test("locating many OMP Sessions walks the session tree once, not once per Session", async () => {
  const { root, ids } = await tree(40)
  try {
    const loader = createOmpHistoryLoader(root)
    for (const id of ids) {
      const page = await loader.page(id, { limit: 5, activeSessionLeaf: null })
      assert.deepEqual(page, { messages: [], before: null, hasMore: false })
    }
    const diagnostics = loader.diagnostics()
    assert.equal(diagnostics.listingScans, 1, `40 Sessions must share one tree walk (scans ${diagnostics.listingScans})`)
    assert.equal(diagnostics.listedFiles, 40)
    assert.equal(diagnostics.resolvedSessions, 40)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an OMP Session created after the listing was taken is still found", async () => {
  const { root, ids } = await tree(3)
  try {
    const loader = createOmpHistoryLoader(root)
    await loader.page(ids[0], { limit: 5, activeSessionLeaf: null })
    assert.equal(loader.diagnostics().listingScans, 1)

    const late = "sess_late_9"
    await writeFile(path.join(root, `2026-08-25T11-00-00_${late}.jsonl`), "")
    // The listing is reused only briefly, so a miss against a stale one walks the tree again.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const page = await loader.page(late, { limit: 5, activeSessionLeaf: null })
    assert.deepEqual(page, { messages: [], before: null, hasMore: false })
    assert.equal(loader.diagnostics().listingScans, 2, "a genuinely new Session must trigger one more walk")
    assert.equal(loader.diagnostics().resolvedSessions, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("an unknown OMP Session id is reported as absent without inventing a file", async () => {
  const { root } = await tree(2)
  try {
    const loader = createOmpHistoryLoader(root)
    const page = await loader.page("sess_missing_0", { limit: 5, activeSessionLeaf: null })
    assert.deepEqual(page, { messages: [], before: null, hasMore: false })
    assert.equal(loader.diagnostics().resolvedSessions, 0)
    // A path-traversal shaped id must never reach the filesystem.
    assert.deepEqual(await loader.page("../escape", { limit: 5, activeSessionLeaf: null }), { messages: [], before: null, hasMore: false })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a missing OMP session root is absent rather than an error", async () => {
  const loader = createOmpHistoryLoader(path.join(os.tmpdir(), `omp-absent-${process.pid}`))
  assert.deepEqual(await loader.page("sess_0_0", { limit: 5, activeSessionLeaf: null }), { messages: [], before: null, hasMore: false })
})
