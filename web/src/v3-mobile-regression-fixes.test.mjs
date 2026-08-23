import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(path.join(here, name), "utf8")

const css = read("v3-mobile-regression-fixes.css")
const main = read("main.tsx")
const workspace = read("components/conversation-workspace.tsx")

assert.match(main, /import "\.\/v3-mobile-regression-fixes\.css"/)
assert.match(css, /@media \(max-width: 780px\), \(pointer: coarse\) and \(max-height: 640px\)/)
assert.match(css, /@media \(pointer: coarse\) and \(max-height: 640px\) and \(min-width: 781px\)/)
assert.match(css, /\.tdw-machine-section[\s\S]*display: block !important/)
assert.match(css, /\.tdw-machine-section \.tdw-side-row\.active/)
assert.match(css, /\.hr-mobile-nav[\s\S]*display: grid !important/)
assert.match(css, /\.tdw-layout[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/)
assert.match(css, /\.tdw-main\.mobile-open[\s\S]*display: flex !important/)
assert.match(css, /\.uw-machine-manager[\s\S]*width: 100% !important/)
assert.match(css, /\.tdw-model-popover[\s\S]*position: fixed !important/)

assert.match(workspace, /function selectMachine\(id: string\)/)
assert.match(workspace, /if \(id !== "all"\) onActiveMachineID\(id\)/)
assert.match(workspace, /selectedMachineID === runtime\.machine\.id/)
assert.match(workspace, /onClick=\{\(\) => selectMachine\(runtime\.machine\.id\)\}/)
assert.match(workspace, /onClick=\{\(\) => selectMachine\("all"\)\}/)

console.log("v3 mobile regression guards: ok")
