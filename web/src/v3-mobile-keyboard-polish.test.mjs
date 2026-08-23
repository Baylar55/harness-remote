import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

/** This checkout may be CRLF (`core.autocrlf`) while the index is LF. Normalise so the assertions
 *  describe the stylesheet, not the line endings of whoever ran them. */
const read = (name) => readFileSync(path.join(here, name), "utf8").replace(/\r\n/g, "\n")

/** Every stylesheet that participates in the mobile cascade, in load order. */
const MOBILE_SHEETS = [
  "taskdesk-workspace-navigation.css",
  "taskdesk-mobile-navigation.css",
  "conversation-control-plane-overrides.css",
  "conversation-control-plane-mobile-polish.css",
  "v3-mobile-regression-fixes.css",
  "v3-mobile-landscape-grid-fix.css",
  "v3-mobile-workspace-switcher-polish.css",
  "v3-mobile-a11y-fix.css",
  "v3-mobile-product-parity.css"
]

const parity = read("v3-mobile-product-parity.css")
const switcher = read("v3-mobile-workspace-switcher-polish.css")
const a11y = read("v3-mobile-a11y-fix.css")
const workspace = read("components/conversation-workspace.tsx")
const standalone = read("components/standalone-universal-workspace.tsx")
const conversation = read("components/taskdesk-conversation.tsx")
const machineClient = read("machineClient.ts")

/** Media preludes, i.e. the text between `@media` and the opening brace. */
function preludes(css) {
  return [...css.matchAll(/@media([^{]+)\{/g)].map((match) => match[1].trim())
}

/**
 * Evaluates the subset of media syntax these sheets actually use: comma-separated clauses of
 * `and`-joined `(feature: value)` pairs over width, height and pointer.
 */
function matches(prelude, viewport) {
  return prelude.split(",").some((clause) => clause.split(/\band\b/).every((raw) => {
    const feature = raw.trim().replace(/^\(|\)$/g, "").trim()
    if (!feature) return true
    const [name, value] = feature.split(":").map((part) => part.trim())
    if (name === "pointer") return value === viewport.pointer
    if (name === "min-width") return viewport.width >= Number.parseInt(value, 10)
    if (name === "max-width") return viewport.width <= Number.parseInt(value, 10)
    if (name === "min-height") return viewport.height >= Number.parseInt(value, 10)
    if (name === "max-height") return viewport.height <= Number.parseInt(value, 10)
    // An unmodelled feature must not silently satisfy the clause.
    return false
  }))
}

// A portrait phone, keyboard down and then keyboard up. Android's adjustResize only shortens the
// WebView, so the width is identical in both and the height crosses the 640px landscape threshold.
const PORTRAIT = { width: 393, height: 851, pointer: "coarse" }
const PORTRAIT_KEYBOARD = { width: 393, height: 400, pointer: "coarse" }
const LANDSCAPE = { width: 860, height: 390, pointer: "coarse" }

test("the soft keyboard cannot put a portrait phone into landscape styling", () => {
  // The bug this guards: a block written for short landscape phones selected on `max-height` alone.
  // Android shortens the viewport when the keyboard opens, so every text field in the app re-rendered
  // the shell in landscape-compact styling until the keyboard closed again.
  const offenders = []
  for (const sheet of MOBILE_SHEETS) {
    for (const prelude of preludes(read(sheet))) {
      const clauses = prelude.split(",")
      // A prelude that also selects every narrow viewport applies in both keyboard states, so an
      // unguarded clause inside it cannot introduce a change when the keyboard opens.
      if (clauses.some((clause) => clause.includes("max-width"))) continue
      for (const clause of clauses) {
        if (!clause.includes("pointer: coarse") || !clause.includes("max-height")) continue
        if (clause.includes("min-width") || clause.includes("max-width")) continue
        offenders.push(`${sheet}: @media${prelude}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `landscape styling selected without a width guard:\n${offenders.join("\n")}`)
})

test("the landscape blocks still reach a real landscape phone", () => {
  // The guard above is only worth having if it did not simply disable landscape support.
  const landscapeOnly = "(pointer: coarse) and (min-width: 600px) and (max-height: 640px)"
  assert.ok(switcher.includes(`@media ${landscapeOnly}`))
  assert.ok(a11y.includes(`@media ${landscapeOnly}`))
  assert.ok(matches(landscapeOnly, LANDSCAPE))
  assert.ok(!matches(landscapeOnly, PORTRAIT_KEYBOARD))
  assert.ok(!matches(landscapeOnly, PORTRAIT))
})

test("opening the keyboard does not move or reframe the New conversation sheet", () => {
  // The sheet is full-bleed with the keyboard down. The keyboard-open block must inherit that frame
  // rather than re-anchoring it, which is what made the window appear to jump to the top of the
  // screen the moment the first message field was tapped.
  const block = keyboardPortraitBlock()
  assert.ok(!/\.tdw-modal-backdrop\s*\{/.test(block), "the keyboard block must not re-anchor the backdrop")
  assert.ok(!/align-items:\s*flex-start/.test(block))
  assert.ok(!/\.hr-new-conversation-modal\s*\{/.test(block), "the keyboard block must not reframe the sheet")
  assert.ok(!/border-radius/.test(block))

  // And the frame it inherits really is the full-bleed one.
  const regression = read("v3-mobile-regression-fixes.css")
  assert.match(regression, /\.tdw-modal-backdrop \{\n\s*padding: 0 !important;\n\s*align-items: stretch !important;/)
})

test("the first message field absorbs the space the keyboard leaves, and never shrinks to fit", () => {
  const block = keyboardPortraitBlock()
  // Pinning the field to a fixed height left roughly a third of the sheet empty while the one field
  // the keyboard was open for became too small to read back what had been typed.
  assert.ok(!/height:\s*86px/.test(block), "the prompt field must not be pinned to a fixed height")
  assert.ok(!/max-height:\s*104px/.test(block))
  assert.match(block, /\.hr-new-conversation-modal \.tdw-prompt-field \{[^}]*flex: 1 1 0 !important;/)
  assert.match(block, /\.hr-new-conversation-modal \.tdw-prompt-field textarea \{[^}]*max-height: none !important;/)
  assert.match(block, /\.hr-new-conversation-modal \.tdw-prompt-field textarea \{[^}]*flex: 1 1 auto !important;/)
  // A floor plus a scrollable body means growth can never push the selectors out of reach.
  assert.match(block, /\.hr-new-conversation-modal \.tdw-prompt-field \{[^}]*min-height: 96px !important;/)
  assert.match(block, /\.hr-new-conversation-modal \.tdw-modal-body \{[^}]*overflow-y: auto !important;/)
})

test("no field in the sheet is small enough to make the WebView zoom on focus", () => {
  // A sub-16px control triggers the WebView's own zoom on focus, which is a second layout jump
  // stacked on the keyboard's. The old block set 13px.
  const block = keyboardPortraitBlock()
  const sizes = [...block.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]))
  const controls = block.match(/\.hr-new-conversation-modal select,[\s\S]*?\}/)
  assert.ok(controls, "the sheet's controls must still be sized explicitly")
  assert.match(controls[0], /font-size: 16px !important/)
  assert.ok(!sizes.includes(13), "13px controls made the WebView zoom the sheet on focus")
})

test("typing in a conversation trims chrome only, never the transcript type or the composer", () => {
  const block = keyboardPortraitBlock()
  assert.match(block, /\.hr-control-plane \.tdw-thread-header \{[^}]*height: 44px !important;/)
  assert.match(block, /\.hr-control-plane \.tdw-detail-tabs,/)
  assert.match(block, /\.hr-control-plane \.tdw-conversation-toolbar \{[^}]*min-height: 38px !important;/)
  // The two things that made the old behaviour feel broken: restyled transcript type, capped input.
  assert.ok(!/uw-markdown/.test(block), "transcript type must read the same with the keyboard up")
  assert.ok(!/uw-composer/.test(block), "the composer must not be resized by its own keyboard")
})

test("a detected harness reads as healthy in the machine list, as it already does everywhere else", () => {
  // `configured` is a harness the daemon knows how to launch and will spawn on first use. It is the
  // ordinary state for a lazily started agent, and the workspace rail and desktop already show it
  // green, so amber here made the same machine look like a warning in one list and fine in another.
  const dots = parity.match(/\.uw-machine-harness > i\.available,[\s\S]*?\.uw-machine-harness > i\.unavailable \{[^}]*\}/)
  assert.ok(dots, "the harness dots must still be styled by state")
  assert.match(dots[0], /\.uw-machine-harness > i\.available,\n\s*\.uw-machine-harness > i\.configured \{\n\s*background: var\(--td3-green\) !important;/)
  assert.ok(!/\.uw-machine-harness > i\.configured \{\s*\n\s*background: var\(--td3-yellow\)/.test(parity))
  assert.ok(!parity.includes("--td3-yellow"), "no mobile harness state is amber any more")

  // Running still differs from ready — by the halo, not by hue.
  assert.match(parity, /\.uw-machine-harness > i\.available \{\n\s*box-shadow: 0 0 0 2px var\(--td3-green-soft\) !important;/)
  assert.match(parity, /\.uw-machine-harness > i\.unavailable \{\n\s*background: var\(--td3-red\) !important;/)
})

test("harness state is never carried by colour alone", () => {
  // The pills hide their state text for room, which left the dot's colour as the only signal: not
  // readable by a screen reader and not separable by a red-green colour-blind user.
  assert.ok(!/\.uw-machine-harness > small \{\n\s*display: none/.test(parity))
  const clipped = parity.match(/\.uw-machine-harness > small \{[^}]*\}/)
  assert.ok(clipped, "the state text must still be handled explicitly")
  assert.match(clipped[0], /clip-path: inset\(50%\) !important;/)
  assert.match(parity, /\.uw-machine-harness:has\(> i\.unavailable\) > small \{[^}]*clip-path: none !important;/)
  // The decorative half of the pair is hidden from assistive tech instead of being read as a letter.
  assert.match(standalone, /<i className=\{agent\.state\} aria-hidden="true" \/>/)
})

test("one definition decides what a harness state is called", () => {
  assert.match(machineClient, /export function machineAgentStateLabel\(state: string\): string \{/)
  assert.match(machineClient, /if \(state === "configured"\) return "Ready"/)
  assert.match(machineClient, /if \(state === "available"\) return "Running"/)
  // Both surfaces read from it, so the machine list and the workspace rail cannot drift apart, and
  // the list shows words rather than the daemon's raw enum.
  assert.match(standalone, /import \{ discoverMachine, machineAgentStateLabel \} from "\.\.\/machineClient"/)
  assert.match(standalone, /\{machineAgentStateLabel\(agent\.state\)\}/)
  assert.match(workspace, /import \{ discoverMachine, machineAgentStateLabel, selectableMachineAgents \} from "\.\.\/machineClient"/)
  assert.match(workspace, /return machineAgentStateLabel\(agent\.state\)/)
  // Neither surface maps a daemon host state to words on its own any more. (Conversation state is a
  // different vocabulary and keeps its own labels; this is specifically about harness host states.)
  for (const source of [workspace, standalone]) {
    assert.ok(!/state === "configured"\) return/.test(source), "harness state wording belongs to machineClient alone")
  }
})

test("a phone can ask its machines to reconnect", () => {
  // Mobile hides every icon button in the top bar because the bottom nav owns navigation. That holds
  // for Settings, which the nav has, but Refresh is not navigation and nothing replaced it: the only
  // way to re-probe a machine that just came back was the ten-second poll.
  assert.match(workspace, /className="tdw-icon-button hr-refresh-button"/)
  assert.match(workspace, /aria-busy=\{refreshing\}/)
  assert.match(parity, /\.hr-control-plane \.tdw-top-actions > \.hr-refresh-button \{[^}]*display: flex !important;/)
  // At least the platform's minimum touch target.
  const rule = parity.match(/\.hr-control-plane \.tdw-top-actions > \.hr-refresh-button \{[^}]*\}/)[0]
  const size = Number(rule.match(/min-height:\s*(\d+)px/)[1])
  assert.ok(size >= 40, `refresh is only ${size}px tall`)
})

test("the composer tells the soft keyboard what its action key does", () => {
  // Enter inserts a newline on a touch device here, so the key must not be labelled "send".
  assert.match(conversation, /enterKeyHint=\{touchFirst \? "enter" : "send"\}/)
  assert.match(workspace, /enterKeyHint="enter"/)
})

/** The one block that describes a keyboard-resized portrait phone. */
function keyboardPortraitBlock() {
  const start = parity.indexOf("@media (pointer: coarse) and (max-width: 599px) and (max-height: 640px)")
  assert.notEqual(start, -1, "the keyboard-resized portrait block must exist")
  const prelude = parity.slice(start).match(/@media[^{]+\{/)[0]
  assert.ok(matches(prelude.replace(/@media|\{/g, "").trim(), PORTRAIT_KEYBOARD), "the block must select a keyboard-open portrait phone")
  assert.ok(!matches(prelude.replace(/@media|\{/g, "").trim(), LANDSCAPE), "and must not select a landscape phone")

  let depth = 0
  let index = start + prelude.length - 1
  for (; index < parity.length; index += 1) {
    if (parity[index] === "{") depth += 1
    else if (parity[index] === "}") {
      depth -= 1
      if (depth === 0) break
    }
  }
  return parity.slice(start, index + 1)
}
