import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import test from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(path.join(here, name), "utf8")

// Every stylesheet the running 3.0 shell loads, directly or through a component import.
const LIVE_STYLESHEETS = [
  "taskdesk-workspace-navigation.css", "taskdesk-workthreads.css", "work-thread-detail.css",
  "conversation-control-plane.css", "conversation-control-plane-overrides.css",
  "conversation-control-plane-mobile-polish.css", "model-picker.css",
  "universal-workspace-readable.css", "universal-workspace-readable-fixes.css",
  "taskdesk-conversation.css", "taskdesk-conversation-fixes.css",
  "taskdesk-mobile-navigation.css", "v3-polish.css", "universal-workspace.css",
  "taskdesk-focus-layout.css"
]

test("no live stylesheet declares text below the 10px legibility floor", () => {
  // Measured in Chromium before this floor: over a third of the visible text on the desktop shell
  // rendered at 8.5px or 9px, including the machine's own connection error.
  const offenders = []
  for (const name of LIVE_STYLESHEETS) {
    const css = read(name).replace(/\/\*[\s\S]*?\*\//g, "")
    for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      if (Number(match[1]) > 0 && Number(match[1]) < 10) offenders.push(`${name}: ${match[0]}`)
    }
    for (const match of css.matchAll(/font:\s*[^;]*?\b([0-9.]+)px/g)) {
      if (Number(match[1]) > 0 && Number(match[1]) < 10) offenders.push(`${name}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test("every live stylesheet in the floor list still exists", () => {
  const present = new Set(readdirSync(here).filter((f) => f.endsWith(".css")))
  for (const name of LIVE_STYLESHEETS) assert.ok(present.has(name), `${name} is missing from the floor list`)
})

test("agent prose is capped to a readable measure without narrowing code or tables", () => {
  const css = read("taskdesk-conversation.css")
  assert.match(css, /\.tdw-work-thread-conversation \.uw-message-agent \.uw-markdown > p,/)
  assert.match(css, /max-width: 62ch;/)
  // Only block prose is listed: pre, table and the tool cards must keep the full width.
  const rule = css.match(/\.tdw-work-thread-conversation \.uw-message-agent \.uw-markdown > p,[\s\S]*?\n\}/)?.[0] || ""
  assert.doesNotMatch(rule, /> pre|> table/)
  // A user message is framed by its own bubble and must not be capped.
  assert.doesNotMatch(rule, /uw-message-user/)
})

test("the activity status label is component copy, not CSS content", () => {
  const component = read("components/taskdesk-message-content.tsx")
  const overrides = read("conversation-control-plane-overrides.css")
  assert.match(component, /function activityStatusLabel\(status: string\): string/)
  assert.match(component, /status === "running" \? "Working" : status/)
  assert.doesNotMatch(overrides, /content: "Working"/)
})

test("a failed or cancelled Conversation does not report Ready in its own header", () => {
  // The list card said "Needs attention" / "Stopped" while the open conversation said "Ready", and
  // for a cancelled Conversation the interruption was not visible anywhere.
  const conversation = read("components/work-thread-conversation.tsx")
  assert.match(conversation, /function conversationOutcome\(status: string\)/)
  assert.match(conversation, /if \(status === "failed"\) return \{ state: "attention", text: "Needs attention" \}/)
  assert.match(conversation, /if \(status === "cancelled"\) return \{ state: "stopped", text: "Stopped" \}/)
  assert.match(conversation, /status=\{task\.status\} detail=\{task\.error\?\.message \|\| undefined\}/)
  assert.match(read("work-thread-detail.css"), /\.tdw-conversation-state\.stopped \{/)
})

test("a select still looks like a select", () => {
  // The base `select` rule draws the dropdown chevron with background-image. Three v3 rules used the
  // `background` shorthand, which silently erased it, so Machine, Project, Coding agent, Theme,
  // Language and Continue with all rendered as plain boxes indistinguishable from text inputs —
  // while the Model control beside them kept its chevron. .tdw-agent-control even reserved 25px of
  // right padding for the arrow that was no longer drawn.
  const base = read("styles.css")
  assert.match(base, /select \{\n\s*appearance: none;[\s\S]*?background-image: linear-gradient/)
  for (const [file, selector] of [
    ["taskdesk-workthreads.css", ".tdw-modal select"],
    ["work-thread-detail.css", ".tdw-agent-control select"],
    ["conversation-control-plane-overrides.css", ".hr-mobile-settings-group select"]
  ]) {
    const css = read(file)
    const rule = css.slice(css.indexOf(selector))
    const body = rule.slice(0, rule.indexOf("}") + 1)
    assert.doesNotMatch(body, /(^|[^-])background:/m, `${selector} must not reset background-image`)
    assert.match(body, /background-color:/, `${selector} must set background-color`)
  }
})
