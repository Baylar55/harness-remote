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

test("mobile keeps Projects as a swipeable filter rail instead of hiding navigation", () => {
  assert.match(mobile, /\.tdw-project-column \{[\s\S]*?display: flex !important/)
  assert.match(mobile, /flex-direction: row !important/)
  assert.match(mobile, /overflow-x: auto/)
  assert.match(mobile, /\.tdw-project-list \{[\s\S]*?display: flex/)
  assert.doesNotMatch(mobile, /\.tdw-project-column \{\s*display: none !important/)
})

test("mobile Work Thread detail uses the full dynamic viewport and avoids duplicated chrome", () => {
  assert.match(mobile, /height: 100dvh/)
  assert.match(mobile, /:has\(\.tdw-main\.mobile-open\) \.tdw-topbar \{[\s\S]*?display: none/)
  assert.match(mobile, /:has\(\.tdw-main\.mobile-open\) \.tdw-main\.mobile-open \{[\s\S]*?inset: 0/)
  assert.match(mobile, /\.tdw-thread-heading p \{[\s\S]*?display: none/)
  assert.match(mobile, /\.tdw-conversation-state \{[\s\S]*?display: none !important/)
})

test("mobile controls are touch and keyboard friendly", () => {
  assert.match(mobile, /\.tdw-thread-search input \{[\s\S]*?font-size: 16px/)
  assert.match(mobile, /\.tdw-modal select,[\s\S]*?font-size: 16px/)
  assert.match(mobile, /\.tdw-modal \{[\s\S]*?max-height: 94dvh/)
  assert.match(mobile, /\.tdw-modal-body \{[\s\S]*?overflow-y: auto !important/)
  assert.match(mobile, /\.tdw-model-popover \{[\s\S]*?position: fixed !important[\s\S]*?bottom: max\(10px, env\(safe-area-inset-bottom\)\)/)
  assert.match(mobile, /\.tdw-work-thread-conversation \.uw-composer-shell \{[\s\S]*?safe-area-inset-bottom/)
  assert.match(mobile, /touch-action: manipulation/)
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
