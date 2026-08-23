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
