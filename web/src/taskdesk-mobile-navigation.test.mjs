import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workspace = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
const standalone = readFileSync(new URL("./components/standalone-universal-workspace.tsx", import.meta.url), "utf8")
const mobile = readFileSync(new URL("./taskdesk-mobile-navigation.css", import.meta.url), "utf8")

test("mobile opens a Work Thread explicitly and can return to the list without clearing selection", () => {
  assert.match(workspace, /const \[mobileDetailOpen, setMobileDetailOpen\] = useState\(false\)/)
  assert.match(workspace, /setSelectedThreadKey\(record\.key\); setMobileDetailOpen\(true\)/)
  assert.match(workspace, /tdw-main\$\{mobileDetailOpen \? " mobile-open" : ""\}/)
  assert.match(workspace, /className="tdw-mobile-back" onClick=\{\(\) => setMobileDetailOpen\(false\)\}/)
  assert.match(workspace, /import "\.\.\/taskdesk-mobile-navigation\.css"/)
  assert.match(mobile, /@media \(max-width: 780px\)/)
  assert.match(mobile, /\.tdw-main \{[\s\S]*?display: none !important/)
  assert.match(mobile, /\.tdw-main\.mobile-open \{[\s\S]*?display: flex !important/)
})

test("Android back unwinds TaskDesk overlays and mobile detail before exiting the app", () => {
  assert.match(standalone, /CapacitorApp\.addListener\("backButton"/)
  assert.match(standalone, /if \(managerOpen\)[\s\S]*?setManagerOpen\(false\)/)
  assert.match(standalone, /\.tdw-modal-backdrop \.tdw-modal header button/)
  assert.match(standalone, /\.tdw-more-menu/)
  assert.match(standalone, /\.tdw-advanced-host \.tdw-advanced-bar > button/)
  assert.match(standalone, /\.tdw-mobile-back/)
  assert.match(standalone, /mobileBack\.getClientRects\(\)\.length > 0/)
  assert.match(standalone, /CapacitorApp\.exitApp\(\)/)
  assert.match(standalone, /if \(document\.querySelector\("\.tdw-classic-host"\)\) return/)
})
