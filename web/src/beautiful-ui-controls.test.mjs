import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import test from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(path.join(here, name), "utf8").replace(/\r\n/g, "\n")

const css = read("beautiful-ui-controls.css")
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "")
const renderer = read("components/taskdesk-message-content.tsx")
const attention = read("components/work-thread-attention.tsx")
const main = read("main.tsx")

test("the ported controls resolve every colour through a theme token", () => {
  // This is the whole reason the port went to plain CSS instead of Tailwind: a literal colour here
  // is a surface that stays dark on the Light theme, which is the defect taskdesk-theme.css exists
  // to prevent. `currentcolor` and `transparent` are theme-independent by definition.
  const literals = [
    ...cssRules.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    ...cssRules.matchAll(/\b(?:rgb|rgba|hsl|hsla)\(/g)
  ].map((match) => match[0])
  assert.deepEqual(literals, [], "use a --td3-* token instead of a literal colour")
})

test("the stylesheet loads last so the port never needs !important", () => {
  assert.match(main, /import "\.\/beautiful-ui-controls\.css"/)
  assert.ok(
    main.indexOf('beautiful-ui-controls.css') > main.indexOf('session-first-workbench.css'),
    "the ported controls must load after the sheets they refine"
  )
  assert.doesNotMatch(cssRules, /!important/, "load order, not !important, settles these ties")
})

test("every animation is unwound for prefers-reduced-motion", () => {
  const guard = cssRules.slice(cssRules.indexOf("@media (prefers-reduced-motion: reduce)"))
  assert.ok(guard, "the stylesheet must carry a reduced-motion guard")
  for (const match of cssRules.matchAll(/animation: (bui-[a-z-]+)/g)) {
    assert.ok(guard.includes(match[1]) || guard.includes("animation: none"), `${match[1]} is not unwound`)
  }
  // The sweep paints the title with a transparent text-fill. Switching the animation off without
  // restoring the fill would leave an invisible header, which is worse than the motion.
  assert.match(guard, /-webkit-text-fill-color: currentcolor/)
})

test("a tool call reports its kind, its cost and a readable outcome", () => {
  assert.match(renderer, /function toolKind\(tool: string \| undefined\): ToolKind/)
  assert.match(renderer, /bui-tool bui-tool-\$\{kind\}/)
  assert.match(renderer, /const duration = formatDuration\(state\?\.time\)/)
  // The protocol words used to reach the screen unchanged: "completed", "error", "running".
  assert.match(renderer, /function toolStatusLabel\(status: string\): string/)
  assert.doesNotMatch(renderer, /"no result" : status/)

  // Every kind the component can produce needs a glyph, and the two that mutate state are the only
  // ones the stylesheet accents - colour stays reserved for status.
  const kinds = [...renderer.matchAll(/^  (read|edit|run|search|web|task|tool):/gm)].map((m) => m[1])
  assert.ok(kinds.length >= 7, `only ${kinds.length} tool kinds are declared`)
  for (const kind of kinds) assert.match(renderer, new RegExp(`\\b${kind}: "`), `${kind} has no glyph`)
  assert.match(cssRules, /\.bui-tool-edit > summary \.bui-tool-kind,\n\.bui-tool-run > summary \.bui-tool-kind/)
})

test("a sub-second call and a missing timestamp show no clock at all", () => {
  // A "0.4s" on every row is noise, and a harness that reports seconds where the type says
  // milliseconds would otherwise render a duration measured in decades.
  assert.match(renderer, /if \(!Number\.isFinite\(ms\) \|\| ms < 1_000 \|\| ms > 86_400_000\) return ""/)
  assert.match(renderer, /if \(seconds < 2 \|\| seconds > 86_400\) return ""/)
  // The clock is fed by the harness's own part timestamps, not by when this component mounted.
  assert.match(renderer, /function activityStartedAt\(group: ActivityGroupValue\)/)
  assert.match(renderer, /part\.state\?\.time\?\.start \?\? part\.time\?\.start/)
})

test("the summary keeps the column count its grids are laid out by", () => {
  // universal-workspace.css and taskdesk-conversation.css both size these summaries with an explicit
  // grid-template-columns. Duration and status therefore share one cell; a fifth child would drop
  // the status under the command at exactly the widths phones use.
  assert.match(renderer, /<span className="bui-tool-meta">/)
  const meta = renderer.match(/<span className="bui-tool-meta">[\s\S]*?<\/span>\n\s*<\/span>/g) || []
  assert.equal(meta.length, 2, "both the tool card and the activity header wrap their meta cell")
  assert.match(cssRules, /\.bui-tool-meta,\n\.bui-activity > summary \.bui-tool-meta \{/)
})

test("the approval card stays actionable with a thumb", () => {
  // The one card the user cannot scroll past: the agent is stopped until it is answered.
  assert.match(attention, /className="tdw-attention bui-approval"/)
  assert.match(attention, /className="bui-approval-scopes"/)
  assert.doesNotMatch(attention, /request\.patterns\.join/, "one chip per scope, not one run-on line")
  assert.match(attention, /className="tdw-button secondary bui-approval-deny"/)

  // A tap that had registered looked like a tap that had not: the selected state was a background
  // tint alone, which is the same feedback hover already gives.
  assert.match(attention, /className="bui-approval-check"/)
  assert.match(cssRules, /\.bui-approval \.tdw-attention-options button\.selected \{/)

  // The global `button` rule in styles.css makes every button a flex box centred on both axes with
  // `white-space: nowrap`, so the `display: block` on the label was describing a flex item: label and
  // description rendered side by side, centred, and a long option could not wrap.
  const option = cssRules.match(/\.bui-approval \.tdw-attention-options button \{[\s\S]*?\n\}/)[0]
  assert.match(option, /flex-direction: column/)
  assert.match(option, /align-items: flex-start/)
  assert.match(option, /color: var\(--td3-text\)/)
  assert.match(option, /white-space: normal/, "a long option label has to be able to wrap")

  for (const selector of [
    /\.bui-approval \.tdw-attention-options button \{\n\s*min-height: 44px;/,
    /\.bui-approval \.tdw-attention-actions \.tdw-button \{\n\s*min-height: 44px;/
  ]) assert.match(cssRules, selector, "decision controls must clear the 44px touch target")
})

test("aria semantics survive the restyle", () => {
  // Everything added is decoration on state that is already spelled out in text.
  assert.match(attention, /aria-live="polite"/)
  assert.match(attention, /aria-pressed=\{selected\.includes\(option\.label\)\}/)
  assert.match(attention, /<i className="bui-approval-dot" aria-hidden="true" \/>/)
  assert.match(renderer, /<span className="bui-tool-kind" aria-hidden="true">/)
})
