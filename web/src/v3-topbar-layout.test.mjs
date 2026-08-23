import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const css = readFileSync(new URL("./taskdesk-workthreads.css", import.meta.url), "utf8")
const topbar = css.match(/\.tdw-topbar \{[\s\S]*?\n\}/)?.[0] || ""

test("the top bar action group is content-sized", () => {
  // minmax(360px, 1fr) plus min-width: 0 on .tdw-top-actions let the button row overflow its own
  // grid area to the left and paint over the breadcrumb. Measured with Chromium at 2560/1920/1600/
  // 1440/1366/1280/1200/1100/1024/900/780/430/390/360/320: the machine-health pill overlapped the
  // breadcrumb at every width from 1200 to 1600 before this, and at none of them after.
  assert.match(topbar, /grid-template-columns: minmax\(200px, 1fr\) minmax\(0, 1fr\) auto;/)
  assert.doesNotMatch(topbar.replace(/\/\*[\s\S]*?\*\//g, ""), /minmax\(360px, 1fr\)/)
})

test("the breadcrumb truncates instead of spilling out of its column", () => {
  const path = css.match(/\.tdw-context-path \{[\s\S]*?\n\}/)?.[0] || ""
  assert.match(path, /min-width: 0;/)
  assert.match(path, /overflow: hidden;/)
})

test("the narrower breakpoints keep their content-sized action column", () => {
  assert.match(css, /minmax\(170px, 1fr\) minmax\(140px, 300px\) auto/)
  assert.match(css, /minmax\(160px, 1fr\) auto/)
})

test("the closed conversation drawer is out of the tab order", () => {
  // opacity + pointer-events hide the drawer from the mouse only. Measured with Chromium at
  // 1440x900: 5 of 23 tab stops on the default desktop screen landed on controls inside the
  // invisible drawer (its close button, the offline banner, the search field, New conversation and
  // the resizer). With visibility it is 0, and 5 again once the drawer is open.
  const layout = readFileSync(new URL("./taskdesk-focus-layout.css", import.meta.url), "utf8")
  const closed = layout.match(/\.tdw-thread-column \{[\s\S]*?\n  \}/)?.[0] || ""
  const open = layout.match(/\.tdw-shell\.task-drawer-open \.tdw-thread-column \{[\s\S]*?\n  \}/)?.[0] || ""
  assert.match(closed, /visibility: hidden;/)
  assert.match(closed, /transition: transform 160ms ease, opacity 120ms ease, visibility 0s linear 160ms;/)
  assert.match(open, /visibility: visible;/)
  assert.match(open, /transition: transform 160ms ease, opacity 120ms ease, visibility 0s;/)
})
