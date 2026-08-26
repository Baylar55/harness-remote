import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")
const hook = read("./useDialogDismiss.ts")
const standalone = read("./components/standalone-universal-workspace.tsx")
const actions = read("./components/native-session-actions.tsx")
const handoff = read("./components/native-session-handoff-control.tsx")

test("every Session-first dialog closes on Escape, traps Tab and restores focus", () => {
  assert.match(hook, /event\.key === "Escape"/)
  assert.match(hook, /event\.key !== "Tab"/)
  assert.match(hook, /if \(previouslyFocused\?\.isConnected\) previouslyFocused\.focus\(\)/)
})

test("an unrendered dialog branch cannot steal Escape from the rendered one", () => {
  assert.match(hook, /if \(!enabled \|\| !container\) return/)
  assert.match(hook, /\}, \[ref, autoFocus, enabled\]\)/)
  assert.match(actions, /useDialogDismiss\(renameRef, close, \{ enabled: mode === "rename" \}\)/)
  assert.match(actions, /useDialogDismiss\(deleteRef, close, \{ enabled: mode === "delete" \}\)/)
})

test("an open model popover inside a Session dialog owns Escape first", () => {
  assert.match(hook, /container\.querySelector\("\.tdw-model-picker\.open"\)/)
  assert.match(standalone, /\.tdw-model-picker\.open \.tdw-model-trigger/)
  assert.match(standalone, /modelPickerTrigger\.click\(\)/)
})

test("the Session-first shell dialogs all use the shared dismissal behaviour", () => {
  assert.match(standalone, /useDialogDismiss\(dialogRef, onClose\)/)
  assert.match(standalone, /useDialogDismiss\(pageRef, onClose, \{ autoFocus: false \}\)/)
  assert.match(actions, /useDialogDismiss\(renameRef, close/)
  assert.match(actions, /useDialogDismiss\(deleteRef, close/)
  assert.match(handoff, /useDialogDismiss/)
})

test("no blocking native dialog is used for destructive Session-first actions", () => {
  const source = `${standalone}\n${actions}`.replace(/^\s*\/\/.*$/gm, "")
  assert.doesNotMatch(source, /window\.confirm/)
  assert.match(standalone, /confirmRemoveID/)
  assert.match(standalone, /uw-machine-confirm/)
  assert.match(actions, /mode === "delete"/)
  assert.match(actions, /hr-session-action-panel/)
})

test("native Session rename keeps phone and keyboard input accessible", () => {
  assert.match(actions, /data-autofocus/)
  assert.match(actions, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Enter"\) void renameSession\(\) \}\}/)
  assert.match(actions, /maxLength=\{200\}/)
  assert.equal(existsSync(new URL("./components/conversation-workspace.tsx", import.meta.url)), false)
})
