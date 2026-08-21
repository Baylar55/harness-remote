import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workspace = readFileSync(new URL("./components/taskdesk-workspace.tsx", import.meta.url), "utf8")
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
