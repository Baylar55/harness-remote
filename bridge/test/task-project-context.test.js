import assert from "node:assert/strict"
import test from "node:test"
import { TaskRunController } from "../src/task-run-controller.js"
import { WorktreeManager } from "../src/worktree-manager.js"

test("direct Git project inspection is read-only and reports changed files", async () => {
  const calls = []
  const manager = new WorktreeManager({
    stateDirectory: "/state",
    runGit: async (args) => {
      calls.push(args)
      if (args.includes("rev-parse")) return { stdout: "/repo\n" }
      return { stdout: " M src/auth.js\n?? test/auth.test.js\n" }
    }
  })

  assert.deepEqual(await manager.inspectProject("/repo"), {
    managed: false,
    dirty: true,
    changeCount: 2,
    changedFiles: ["src/auth.js", "test/auth.test.js"]
  })
  assert.deepEqual(calls, [
    ["-C", "/repo", "rev-parse", "--show-toplevel"],
    ["-C", "/repo", "status", "--porcelain=v1", "--untracked-files=all"]
  ])
})

test("Task Context includes changes from a direct Git project checkout", async () => {
  const task = {
    id: "task-project",
    status: "completed",
    prompt: "Fix authentication",
    project: { kind: "git", path: "/repo" },
    workspace: { mode: "project", path: "/repo" },
    run: { id: "run-1", sequence: 1, agentId: "codex", status: "completed", sessionId: "codex-1", prompt: "Fix authentication" },
    runs: [],
    context: { version: 1, revision: 1 }
  }
  const controller = new TaskRunController({
    taskStore: { async list() { return [] }, async get() { return structuredClone(task) } },
    taskLauncher: {},
    worktreeManager: {
      async inspectProject(projectPath) {
        assert.equal(projectPath, "/repo")
        return { managed: false, dirty: true, changeCount: 1, changedFiles: ["src/auth.js"] }
      }
    }
  })

  const context = await controller.context("task-project")
  assert.deepEqual(context.changedFiles, ["src/auth.js"])
  assert.equal(context.workspace.dirty, true)
  assert.equal(context.workspace.changeCount, 1)
})

test("non-Git project context falls back without invoking Git inspection", async () => {
  const task = {
    id: "task-dir",
    status: "completed",
    prompt: "Inspect docs",
    project: { kind: "directory", path: "/docs" },
    workspace: { mode: "project", path: "/docs" },
    run: null,
    runs: [],
    context: { version: 1, revision: 0 }
  }
  let inspections = 0
  const controller = new TaskRunController({
    taskStore: { async list() { return [] }, async get() { return structuredClone(task) } },
    taskLauncher: {},
    worktreeManager: { async inspectProject() { inspections += 1; throw new Error("should not inspect") } }
  })

  const context = await controller.context("task-dir")
  assert.equal(inspections, 0)
  assert.deepEqual(context.changedFiles, [])
  assert.equal(context.workspace.dirty, false)
})
