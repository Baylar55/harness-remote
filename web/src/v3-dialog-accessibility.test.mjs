import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const hook = read("./useDialogDismiss.ts")
const workspace = read("./components/conversation-workspace.tsx")
const standalone = read("./components/standalone-universal-workspace.tsx")

test("every dialog closes on Escape, traps Tab and restores focus", () => {
  assert.match(hook, /event\.key === "Escape"/)
  assert.match(hook, /event\.key !== "Tab"/)
  assert.match(hook, /if \(previouslyFocused\?\.isConnected\) previouslyFocused\.focus\(\)/)
})

test("an unrendered dialog branch cannot steal Escape from the rendered one", () => {
  // NewConversationModal renders one of two dialogs and therefore calls the hook twice. The branch
  // that is not rendered has a null ref; without a guard it still registered a document Escape
  // listener with no container, which closed the dialog even while its model picker was open.
  assert.match(hook, /if \(!enabled \|\| !container\) return/)
  assert.match(hook, /\}, \[ref, autoFocus, enabled\]\)/)
  assert.match(workspace, /enabled: Boolean\(runtime\)/)
  assert.match(workspace, /enabled: !runtime/)
})

test("an open popover inside a dialog owns Escape first", () => {
  // Escape on the model picker must not throw away the New Conversation form behind it.
  assert.match(hook, /container\.querySelector\("\.tdw-model-picker\.open"\)/)
  assert.match(workspace, /document\.querySelector\("\.tdw-modal-backdrop, \.uw-manager-backdrop, \.hr-mobile-settings-page"\)/)
})

test("the 3.0 shell dialogs all use the shared behaviour", () => {
  assert.match(workspace, /useDialogDismiss\(dialogRef, onClose\)/)
  assert.match(workspace, /useDialogDismiss\(emptyDialogRef, onClose, \{ enabled: !runtime \}\)/)
  assert.match(workspace, /useDialogDismiss\(dialogRef, onClose, \{ autoFocus: !coarsePointer\(\), enabled: Boolean\(runtime\) \}\)/)
  assert.match(standalone, /useDialogDismiss\(dialogRef, onClose\)/)
  assert.match(standalone, /useDialogDismiss\(pageRef, onClose, \{ autoFocus: false \}\)/)
})

test("no blocking native dialog is used for destructive machine actions", () => {
  // window.confirm renders as a bare system alert on top of the Android WebView.
  assert.doesNotMatch(standalone.replace(/^\s*\/\/.*$/gm, ""), /window\.confirm/)
  assert.match(standalone, /confirmRemoveID/)
  assert.match(standalone, /uw-machine-confirm/)
})

test("New Conversation does not raise the phone keyboard over its own selectors", () => {
  assert.match(workspace, /function coarsePointer\(\)/)
  assert.doesNotMatch(workspace, /rows=\{7\} autoFocus/)
  assert.match(workspace, /data-autofocus/)
  // A keyboard user can still start without reaching for the mouse.
  assert.match(workspace, /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/)
})
