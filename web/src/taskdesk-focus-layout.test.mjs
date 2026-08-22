import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workspace = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("./taskdesk-focus-layout.css", import.meta.url), "utf8")

test("desktop and tablet default to chat focus with a contextual task drawer", () => {
  assert.match(workspace, /taskDrawerOpen/)
  assert.match(workspace, /tdw-tasks-toggle/)
  assert.match(workspace, /tdw-task-drawer-scrim/)
  assert.match(workspace, /setTaskDrawerOpen\(false\).*setMobileDetailOpen\(true\)/s)
  assert.match(workspace, /event\.key === "Escape".*setTaskDrawerOpen\(false\)/s)

  assert.match(css, /@media \(min-width: 781px\)/)
  assert.match(css, /grid-template-columns: var\(--tdw-workspace-width\) minmax\(0, 1fr\)/)
  assert.match(css, /\.tdw-thread-column \{[\s\S]*position: absolute/)
  assert.match(css, /\.tdw-shell\.task-drawer-open \.tdw-thread-column/)
})

test("focus layout does not replace the existing mobile list detail navigation", () => {
  assert.match(css, /@media \(max-width: 780px\)/)
  assert.match(css, /\.tdw-task-drawer-scrim,[\s\S]*\.tdw-tasks-toggle[\s\S]*display: none !important/)
})
