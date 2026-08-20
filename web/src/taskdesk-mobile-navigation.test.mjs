import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./taskdesk-mobile-navigation.ts", import.meta.url), "utf8")

test("TaskDesk mobile mirrors New Task and New Session into the visible list pages", () => {
  assert.match(source, /NEW_TASK_BUTTON_CLASS/)
  assert.match(source, /NEW_SESSION_BUTTON_CLASS/)
  assert.match(source, /button\.textContent = "\+ New Task"/)
  assert.match(source, /button\.textContent = "\+ New Session"/)
  assert.match(source, /find\(\(candidate\) => buttonLabel\(candidate\) === "New Task"\)/)
  assert.match(source, /root\.querySelector<HTMLButtonElement>\("\.uw-new-button"\)\?\.click\(\)/)
})

test("TaskDesk mobile keeps an explicit Session choice stable across background refreshes", () => {
  assert.match(source, /let manuallySelectedSession: HTMLButtonElement \| null = null/)
  assert.match(source, /manuallySelectedSession = sessionCard/)
  assert.match(source, /restoreManualSelection/)
  assert.match(source, /manuallySelectedSession\.classList\.contains\("selected"\)/)
  assert.match(source, /manuallySelectedSession\.click\(\)/)
  assert.match(source, /attributes: true/)
  assert.match(source, /attributeFilter: \["class"\]/)
})
