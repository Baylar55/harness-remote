import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workspace = readFileSync(new URL("./components/conversation-workspace.tsx", import.meta.url), "utf8")
const navigationCss = readFileSync(new URL("./taskdesk-workspace-navigation.css", import.meta.url), "utf8")

test("the conversation pane separator survives a cancelled pointer", () => {
  // A touch that turns into a scroll never fires pointerup, which left the move listener attached
  // to the window and the pane following the cursor with nothing held down.
  assert.match(workspace, /window\.addEventListener\("pointercancel", finish\)/)
  assert.match(workspace, /window\.removeEventListener\("pointercancel", finish\)/)
  assert.doesNotMatch(workspace, /\{ once: true \}/)
})

test("the conversation pane separator is keyboard operable", () => {
  assert.match(workspace, /onKeyDown=\{onConversationPaneKeyDown\}/)
  assert.match(workspace, /tabIndex=\{0\}/)
  assert.match(workspace, /aria-valuenow=\{conversationPaneWidth\}/)
  assert.match(workspace, /aria-valuemin=\{MIN_CONVERSATION_PANE_WIDTH\}/)
  assert.match(workspace, /aria-valuemax=\{MAX_CONVERSATION_PANE_WIDTH\}/)
  assert.match(navigationCss, /\.tdw-pane-resizer:focus-visible/)
})

test("a width write cannot fail typing or resizing in a storage-less browser", () => {
  const commit = workspace.match(/function commitConversationPaneWidth[\s\S]*?\n  \}/)?.[0] || ""
  assert.match(commit, /try \{/)
  assert.match(commit, /\} catch \{/)
})

test("New Conversation says which machine is blocked and why", () => {
  assert.match(workspace, /const blockers = runtimes/)
  assert.match(workspace, /Connected, but no project is configured on this machine\./)
  assert.match(workspace, /Connected, but no coding agent was discovered on this machine\./)
  assert.match(workspace, /tdw-blocker-list/)
})

test("choosing a machine or project updates the machine New Conversation defaults to", () => {
  assert.match(workspace, /if \(id !== "all"\) onActiveMachineID\(id\)/)
  assert.match(workspace, /onActiveMachineID\(record\.runtime\.machine\.id\)/)
})

test("a Conversation that was created but failed to launch is not lost", () => {
  // createTask succeeded on the machine; only launch failed. Leaving the modal on a generic error
  // hid a Conversation that already existed and turned up later, unexplained, in the list.
  assert.match(workspace, /const created = await taskClient\.createTask/)
  assert.match(workspace, /onCreated\(runtime, created\)/)
  assert.match(workspace, /The conversation was created but could not be started/)
})

test("removing the last machine does not leave Refresh disabled forever", () => {
  const guard = workspace.match(/if \(machines\.length === 0\) \{[\s\S]*?\n    \}/)?.[0] || ""
  assert.match(guard, /setRefreshing\(false\)/)
})
