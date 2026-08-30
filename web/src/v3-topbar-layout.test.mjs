import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const css = readFileSync(new URL("./taskdesk-workthreads.css", import.meta.url), "utf8")
const workspace = readFileSync(new URL("./components/standalone-universal-workspace.tsx", import.meta.url), "utf8")
const workbench = readFileSync(new URL("./session-first-workbench.css", import.meta.url), "utf8")
const topbar = css.match(/\.tdw-topbar \{[\s\S]*?\n\}/)?.[0] || ""

test("the top bar action group is content-sized", () => {
  assert.match(topbar, /grid-template-columns: minmax\(200px, 1fr\) minmax\(0, 1fr\) auto;/)
  assert.doesNotMatch(topbar.replace(/\/\*[\s\S]*?\*\//g, ""), /minmax\(360px, 1fr\)/)
})

test("the Session breadcrumb truncates instead of spilling out of its column", () => {
  const path = css.match(/\.tdw-context-path \{[\s\S]*?\n\}/)?.[0] || ""
  assert.match(path, /min-width: 0;/)
  assert.match(path, /overflow: hidden;/)
  assert.match(workspace, /className="tdw-context-path"/)
  assert.match(workspace, /selectedMachine\?\.name/)
  assert.match(workspace, /selectedProject/)
  assert.match(workspace, /selected\.title/)
})

test("the narrower breakpoints keep their content-sized action column", () => {
  assert.match(css, /minmax\(170px, 1fr\) minmax\(140px, 300px\) auto/)
  assert.match(css, /minmax\(160px, 1fr\) auto/)
})

test("the native Session rail disappears when the mobile detail takes over", () => {
  assert.match(workspace, /hr-native-workspace-detail\$\{mobileDetailOpen \? " mobile-open" : ""\}/)
  assert.match(workbench, /\.hr-native-workspace:has\(\.hr-native-workspace-detail\.mobile-open\) > \.tdw-topbar/)
  assert.match(workbench, /\.hr-native-workspace-body \{[\s\S]*?grid-template-columns: 1fr/)
  assert.match(workbench, /\.hr-rail-resizer \{[\s\S]*?display: none/)
  assert.equal(existsSync(new URL("./components/conversation-workspace.tsx", import.meta.url)), false)
})
