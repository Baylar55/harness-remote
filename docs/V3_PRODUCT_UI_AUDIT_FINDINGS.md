# Harness Remote 3.0 — independent product / UI audit findings

Workstream B of the parallel pre-merge audit (#289). Branch `audit/claude-v3-product-ui`, draft PR #291,
based on the frozen baseline `56c5c9d925045fbef542650c6d564ce502c72758`.

The handoff and the rules of engagement live in `V3_CLAUDE_PRODUCT_UI_AUDIT.md`. This file is the
findings register: what was found, what was changed, what was deliberately not changed, and what
depends on someone else.

## How this was audited

Static reading of the live component tree, plus a real browser. The app was built, served, and driven
in Chromium (Playwright) against a stub machine daemon that answers `/v1/machine`, `/v1/projects`,
`/v1/work-threads`, `/v1/agents/:id/models` and `/session/:id/message` with a workspace containing
five coding agents, two projects and three Conversations in working / failed / cancelled states.

Measurements were taken at 2560, 1920, 1600, 1440, 1366, 1280, 1200, 1100, 1024, 900, 820, 780, 600,
430, 390, 360 and 320 CSS px, in both themes. The stub and the driver scripts are not committed: they
are throwaway audit tooling, and the behaviours they exposed are pinned by the regression suites
listed at the end instead.

## What the 3.0 shell actually is

Worth stating plainly, because the tree does not make it obvious:

```
main.tsx
  StandaloneUniversalWorkspace      machines, mobile nav, mobile settings
    ConversationWorkspace           sidebar, conversation list, New Conversation, settings modal
      ConversationDetail            title, Chat / Sessions / Changes
        WorkThreadConversation      Continue with, model, attention, state
          TaskDeskConversation      transcript + composer
            TaskDeskMessageContent  markdown, reasoning, tools
```

Everything else under `web/src/components/` is unreachable from the running app. See finding P1.

---

## Findings

Severity is user impact, not effort. **Fixed** findings link to the commit that closed them.

### Correctness and product truth

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| C1 | **High** | A failed or cancelled Conversation reported **"Ready"** in its own header while its card in the list said "Needs attention" or "Stopped". The state pill only knew working / pending-question / ready. For a cancelled Conversation the interruption was not visible anywhere in the detail view — the direct opposite of the "a real interruption remains visible" rule in #197. | Fixed `4ccaa8b` |
| C2 | **High** | Crash recovery cleared the wrong keys. `ErrorBoundary` exists so a poisoned setting cannot brick the next launch, and on Android specifically so a crash is not an unrecoverable black screen. Its reset list held only the 2.x server-profile keys, but 3.0 boots from `harness-remote.workspace.machines.v1`, which was not in the list. A machine entry that crashed the render reproduced the crash on every launch while the recovery button cleared keys nobody reads. | Fixed `36f1469` |
| C3 | **High** | A machine known to be offline was invisible on a phone. Below 780px the machine-health pill, the whole Machines section and the harness list are `display: none`. The list kept rendering stale conversations and the user found out only when a message failed — the Android symptom in #287, made worse by the UI hiding state it already had. | Fixed `bea15d9` |
| C4 | Medium | A Conversation whose `createTask` succeeded but whose `launch` failed was never handed to the workspace. It existed on the machine and turned up in the list on a later poll with no explanation. | Fixed `4ee49fd` |
| C5 | Medium | A slow `listTasks` response could overwrite a Conversation the open detail view had already reconciled, producing a visible Working → Ready → Working flicker. | Fixed `5146661` |
| C6 | Low | Removing the last machine while a discovery was in flight returned early without clearing `refreshing`, leaving Refresh disabled for the rest of the session. | Fixed `4ee49fd` |

### Performance

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| F1 | **High** | Every keystroke in the composer ran `taskConversationSignature(task)` — a `JSON.stringify` over every Run — because it was computed unconditionally in render. Cost scaled with conversation length, on the input path. | Fixed `875b9ed` |
| F2 | **High** | Every keystroke wrote `localStorage` synchronously to persist the draft. Measurable input cost in the Android WebView. Now debounced at 400ms and flushed when the conversation is left. | Fixed `875b9ed` |
| F3 | **High** | The 10s workspace poll replaced the whole runtime object graph even when the payload was byte-identical, so `conversations` / `projects` / `agents` all changed identity and the open Conversation, its toolbar and its transcript re-rendered every ten seconds. | Fixed `5146661` |
| F4 | Medium | The same poll flipped an already-known-offline machine back to `loading` before each probe, so the sidebar cycled "Connecting…" → "Machine offline" indefinitely. | Fixed `5146661` |
| F5 | Medium | The Changes tab reloads on every `conversation.updatedAt`, which moves on every turn of a running conversation, and each reload replaced the rendered diff with a spinner — discarding scroll position and collapsing every expanded file, several times a minute. | Fixed `f7032bb` |
| F6 | Low | The working clock kept a 1s interval alive while the agent was idle. | Fixed `875b9ed` |

### Layout and responsiveness

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| L1 | **High** | The top bar action group overflowed its own grid area and painted over the breadcrumb. `minmax(360px, 1fr)` plus `min-width: 0` on `.tdw-top-actions`, with `justify-content: flex-end`, pushed the overflow left. Measured: the machine-health pill overlapped the breadcrumb at **every width from 1200 to 1600** — the entire common laptop range. | Fixed `2232c55` |
| L2 | Medium | Agent prose ran to a 991px line at 1440px and 1920px, ~146 average characters against a comfortable 45–90. Capped to 62ch, measured at 611px / ~90 characters. | Fixed `4ccaa8b` |
| L3 | Medium | Over a third of the visible desktop text rendered below 10px, including the daemon's own connection error at 8.5px. Contrast was already fine (7.4:1 – 16:1 in dark, 4.9:1 – 18:1 in light); the problem is purely size. | Fixed `4ccaa8b` |
| L4 | Low | The mobile chat screen spends 331px of an 844px viewport on chrome (back bar 46, header 65, tabs 45, Continue-with toolbar 73, composer 102). At 667px — an iPhone SE — that is half the screen. See P4. | Open, proposed |
| L5 | Low | An empty composer is 145px tall on desktop. | Open, proposed |
| L6 | Medium | **Every `<select>` in the product had lost its dropdown chevron.** The base `select` rule draws one with `background-image`; three v3 rules set the `background` shorthand, which silently erased it. Machine, Project, Coding agent, Theme, Language and Continue with all rendered as plain boxes indistinguishable from text inputs — while the Model control beside them kept its chevron. `.tdw-agent-control select` even reserved 25px of right padding for the arrow that was no longer drawn, which is what identifies this as an unintended regression rather than a design choice. | Fixed `4c69ca6` |

### Accessibility

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| A1 | **High** | 5 of 23 tab stops on the default desktop screen landed inside the closed conversation drawer. It is hidden with `opacity: 0` + `pointer-events: none`, which hides it from the mouse only: its close button, the search field, the empty-state New conversation button and the resizer stayed in the tab order and in the screen-reader tree. | Fixed `bc31256` |
| A2 | **High** | No dialog closed on Escape. New Conversation, Settings, Machines and mobile Settings were mouse-only, focus stayed behind the dialog so Tab kept walking the workspace underneath, and closing one dropped focus onto `<body>`. | Fixed `b5c217c` |
| A3 | Medium | The composer — the product's primary input — was labelled only by its placeholder, which disappears as soon as the field has content. | Fixed `d6b197e` |
| A4 | Medium | The Chat / Sessions / Changes tabs were three plain buttons: no `tablist`, no `aria-selected`, no panel association, no arrow-key navigation. | Fixed `f7032bb` |
| A5 | Medium | The pane separator was drag-only: no `tabIndex`, no arrow keys, no `aria-valuenow`. | Fixed `2b50fa8` |
| A6 | Medium | The attention surface (questions and permissions) was not announced, and its option buttons — which behave as radios and checkboxes — reported no pressed state. | Fixed `bea15d9` |
| A7 | Low | The conversation search field and the custom-answer field were unnamed. | Fixed `bea15d9` |
| A8 | Low | A running activity was relabelled with `font-size: 0` plus a `content: "Working"` pseudo-element, so user-facing copy lived in CSS and the raw protocol word "running" stayed as the element's real text. | Fixed `4ccaa8b` |
| A9 | Low | Escape ownership was undefined: dismissing the model picker also threw away the filled-in New Conversation form behind it, and closing a modal also collapsed the conversation list. | Fixed `b5c217c` |

### Mobile

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| M1 | **High** | "Needs attention" was unreachable on a phone. The Conversation filters live in the sidebar and the whole filter section is `display: none` below 780px, so the only way to find a conversation waiting on a question was to scroll and read every card — in a product whose central promise is knowing what is running, ready, stopped, failed or waiting. | Fixed `3373121` |
| M2 | Medium | Removing a machine used `window.confirm`, which the Android WebView renders as a bare system alert on top of the app. | Fixed `b5c217c` |
| M3 | Medium | Renaming a Conversation used `window.prompt`, which the Android WebView renders outside the app and some embeddings suppress entirely — leaving rename simply not working there. | Fixed `f7032bb` |
| M4 | Medium | New Conversation autofocused its first-message textarea unconditionally, raising the on-screen keyboard over the machine, project, agent and model selectors it sits below. | Fixed `b5c217c` |
| M5 | Medium | The composer hint on a coarse pointer read "Ctrl/Cmd+Enter to send" — naming the one way to send that a phone keyboard cannot produce. | Fixed `d6b197e` |
| M6 | Low | The pane separator listened for `pointerup` only. A cancelled pointer — a touch that turns into a scroll — never fires it, leaving the move listener attached to the window with nothing held down. | Fixed `2b50fa8` |
| M7 | Low | The mobile shell leans on `:has()` throughout. Fine on any Chromium ≥105, but an older Android System WebView degrades the layout rather than the styling. Worth a minimum-WebView note in the release checklist. | Open, documented |

### Model and harness selection

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| S1 | Medium | New Conversation surfaced a model-discovery failure through the modal's red `role="alert"` block, directly contradicting the rule established in #287 that discovery is not an acceptance prerequisite — the Conversation starts fine on the harness default. | Fixed `2c3db67` |
| S2 | Medium | `ModelPicker` disabled itself while still showing "Choose model" whenever the catalog came back empty, which reads as a broken control with no explanation ("errors that leave the picker disabled or stuck", #287 §2). | Fixed `2c3db67` |
| S3 | Medium | "No coding machine is ready" gave no way forward: no indication of which machine was blocked or why. | Fixed `2b50fa8` |
| S4 | Low | Selecting a machine or project in the sidebar did not update the active machine, so New Conversation kept defaulting to the machine of the last opened Conversation. | Fixed `2b50fa8` |

### Product, information architecture and code health

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| P1 | **High** | **~12 900 lines of unreachable UI code.** `App.tsx` (5 443), `universal-workspace.tsx` (1 852), `taskdesk-v3-unified.tsx` (1 779), `taskdesk-workspace.tsx` (730), `taskdesk-v3.tsx` (644), `panels.tsx` (569), `shell.tsx` (417), `work-thread-detail.tsx` (349), `task-launch-dialog.tsx` (315), `session-list.tsx` (307), `taskdesk-home.tsx` (283), `session-composer.tsx` (93), `TaskDeskTestPage.tsx` (68), `taskdeskHomeModel.ts` (49). None is reachable from `main.tsx`. | Open, proposed |
| P2 | **High** | **12 of the 32 regression suites assert against those dead files** — `attachments`, `model-regression`, `platform-regression`, `server-config`, `ui-regression` against `App.tsx`; `taskdesk-composer-performance`, `taskdesk-conversation-component`, `taskdesk-live-event-routing`, `taskdesk-message-paging`, `taskdesk-performance` against `universal-workspace.tsx` / `taskdesk-v3-unified.tsx`; `taskdesk-focus-layout` against `taskdesk-workspace.tsx`; `taskdesk-home` against `taskdeskHomeModel`. Green CI therefore overstates confidence in the shipped shell. | Open, proposed |
| P3 | Medium | **Two test files are never executed by any npm script**: `taskdesk-focus-layout.test.mjs` and `work-thread-timeline-late.test.mjs`. The first **fails** today — it asserts a heading structure that `taskdesk-workspace.tsx` no longer has — and nobody sees it. | Open, proposed |
| P4 | Medium | **The Settings → Language control is effectively a no-op in the 3.0 shell.** `i18n.ts` carries four languages and ~300 keys, but only the settings modal itself calls `t()`. Choosing Italian translates six labels and leaves the entire product in English. The control is currently a promise the shell does not keep. | Open, decision needed |
| P5 | Medium | The dead shells' stylesheets are still on the critical path. `main.tsx` imports `styles.css` (104 KB, almost entirely `.app-*` rules for the dead Classic shell, though its reset, base typography, form controls and `:root[data-theme]` tokens *are* load-bearing), `taskdesk-v3.css` (36 KB) and `taskdesk-v3-unified.css` (20 KB). The two `taskdesk-v3*` files each still contain a handful of rules that match live elements, so neither can simply be dropped. Built CSS is 249 KB / 41 KB gzipped. | Open, proposed |
| P6 | Low | The Machines manager and its editor are hardcoded English while the settings modal beside them uses `t()`. Same inconsistency as P4, in one screen. | Open, proposed |
| P7 | Low | The offline banner added by C3 lives in the conversation column, which is a hidden drawer on desktop. Desktop is covered by the sidebar entry, so nothing is lost — but the two signals should eventually be one component. | Open, noted |

---

## Task / TaskDesk terminology still present

The product is Harness Remote 3.0. #289 allows internal `task*` names to remain where renaming them
would be risky churn. This is the full inventory, split by risk.

### Rendered copy — clean

No rendered string in the live shell says Task or TaskDesk. Pinned by
`v3-terminology.test.mjs`.

### Renamed here

| Identifier | Was | Now | Why it was safe |
|---|---|---|---|
| Synthetic timeline role | `role: "taskdesk"` | `CONVERSATION_EVENT_ROLE` / `"conversation-event"` | Invented entirely by the client for handoff and lifecycle lines, never sent to or received from a harness, read in one place. |

### Deliberately left — rename later, not now

| Kind | Examples | Why not now |
|---|---|---|
| HTTP routes | `/v1/tasks`, `/v1/tasks/:id/launch`, `/v1/tasks/:id/continue`, `/v1/tasks/:id/result` | Backend contract. Owned by #287 / #292; the newer `/v1/work-threads/*` routes already coexist. |
| Client module and types | `taskClient.ts`, `taskMachineClient.ts`, `MachineTask`, `MachineTaskRun`, `TaskWorkspaceInspection`, `createTask`, `listTasks`, `continueTask` | Mirrors the routes above. Renaming the client before the routes would leave two vocabularies instead of one. |
| DOM class names | 89 distinct `tdw-*` classes in the live components, including `tdw-tasks-toggle`, `tdw-task-drawer-scrim`, `tdw-task-drawer-heading`, `tdw-task-drawer-count` | Not user-visible. A rename touches ~15 stylesheets and every static regression assertion at once, for no user benefit. Best done as one mechanical commit after the merge. |
| Module and stylesheet names | 32 files named `taskdesk-*`, plus the `TaskDeskConversation` and `TaskDeskMessageContent` components | Same reasoning. Note that these two components are the *shared* conversation surface, so their names are the most misleading of the set. |
| Storage keys | `harness-remote.taskdesk.draft.<id>`, `opencode.remote.language`, `opencode.remote.theme` | Renaming silently discards saved drafts and preferences unless a migration is written. Worth doing with a migration, not without one. |
| Dev-only | `?taskdesk-test=1`, `TaskDeskTestPage.tsx` | Dev build only. |
| Android back-button selectors | `.tdw-task-drawer-scrim`, `.tdw-modal-backdrop .tdw-modal header button` | These couple the Capacitor back handler to CSS class names by `querySelector`. They must be renamed *with* the class names, not before, and the coupling itself is worth replacing with explicit state. |

---

## Proposed, not implemented

Each of these is either a decision for the owner or too large to land inside an audit branch.

1. **Delete the dead shells (P1, P2, P3).** One commit removing the fourteen unreachable modules and
   their stylesheets, one commit rewriting the twelve suites that assert against them to assert
   against the live components instead, one commit adding the two orphaned test files to CI and
   fixing the failing one. This is the single largest maintainability win available, and it is
   mechanical — but it will conflict with anything else in flight against those files, so it wants
   its own PR after #286 and #288 land.
2. **Decide what Language means (P4).** Either localize the 3.0 shell — roughly 80 new keys across
   four languages, which is real translation work, not a refactor — or hide the control until it is
   backed by something. Shipping a preference that changes six labels is worse than not offering it.
   I did not remove it unilaterally because that is a product call.
3. **Compact the mobile conversation chrome (L4).** The Continue-with and Model selectors take 73px
   of permanent vertical space on a phone for controls used once per handoff. Collapsing them into a
   single compact row, or behind the header, gives the transcript back about 8% of a 844px viewport
   and about 11% of an iPhone SE.
4. **Reduce the empty composer (L5).** 145px on desktop for an empty input.
5. **Copy affordance for code blocks.** A coding-agent product where a snippet cannot be copied on a
   phone without a text selection is missing an obvious affordance. `clipboard.ts` already exists.
6. **Replace the Android back-button DOM queries with explicit state.** The handler in
   `standalone-universal-workspace.tsx` finds and clicks elements by CSS selector. It works, but any
   class rename silently breaks the hardware back button, and there is no test that would catch it.
7. **Minimum WebView note (M7).** The mobile layout depends on `:has()`. Worth stating the floor in
   the release checklist rather than discovering it on an old device.

---

## Backend dependencies

**None.** Nothing in this branch required a change to model discovery, capability or cache ownership,
ACP/HTTP transport, native Session lifecycle, prompt idempotency, Stop or reconnect semantics,
diagnostics, or OpenCode event fanout. Two things came close and were deliberately kept on the client
side:

- **C5** is client-side reconciliation only: the polled list is merged onto what the client already
  knows, server order stays authoritative and a newer server record always wins. No cadence, no
  transport, no lifecycle semantics changed.
- **C3** surfaces a state the client had already computed. It starts no new probe and changes no
  reconnect behaviour.

One observation for #292 rather than a dependency: `taskClient.listAgentModels` single-flights
in-flight requests but keeps no result cache, so every mount of a Conversation re-requests the
catalog for its agent. Whether that should be cached — and on what key, given the project/cwd scoping
agreed in #287 — is a capability-contract decision, not a UI one.

---

## Tests

Added, all wired into `npm run test:v3-product-ui` and into `pr-checks.yml`:

| Suite | Covers |
|---|---|
| `workspace-runtime-merge.test.mjs` | 8 behavioural unit tests over the real merge functions: identity reuse, empty-list churn, a slow response not moving a Conversation backwards, a newer server record winning, additions and removals |
| `v3-conversation-input-performance.test.mjs` | F1, F2, F6, S1, S2 |
| `v3-dialog-accessibility.test.mjs` | A2, A9, M2, M4 |
| `v3-conversation-detail.test.mjs` | F5, A4, M3 |
| `v3-workspace-navigation.test.mjs` | A5, M6, S3, S4, C4, C6 |
| `v3-composer-accessibility.test.mjs` | A3, M5 |
| `v3-offline-visibility.test.mjs` | C3, A6, A7, M1 |
| `v3-crash-recovery.test.mjs` | C2 |
| `v3-terminology.test.mjs` | Rendered copy stays free of Task/TaskDesk; the synthetic role rename |
| `v3-topbar-layout.test.mjs` | L1, A1 |
| `v3-conversation-readability.test.mjs` | L2, L3, A8, C1 — including a floor check that fails if any live stylesheet reintroduces text below 10px |

Updated: `settings-regression.test.mjs` (inline machine-removal confirmation),
`taskdesk-home.test.mjs` and `v3-ux-polish-regression.test.mjs` (the activity label is component copy
now, which is the behaviour they were protecting).

Green on this head: `tsc -b`, `vite build`, and every suite in `pr-checks.yml`.

Refs #197
Refs #287
Refs #289
Refs #291
