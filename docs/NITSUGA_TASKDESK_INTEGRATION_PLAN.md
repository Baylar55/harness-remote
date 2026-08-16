# Nitsuga → TaskDesk Integration Plan

> **Status:** active integration plan
>
> **Working branch:** `integration/nitsuga-taskdesk`
>
> **Baseline:** `archive/harness-3-2026-08-15`
>
> **Tracking issue:** #197

## Goal

Safely rebuild the next TaskDesk/Harness 3 line from the archived merged baseline, useful stabilization work from `nitsuga/harness-remote`, and selected task-first work that remained unmerged in upstream PR #172.

The objective is not to merge either development line wholesale. Recover coherent blocks, verify them against the regressions that triggered the rollback, and only then decide what is suitable for the next TaskDesk line.

## Non-negotiable safety rules

- Do not modify or merge into `main` during evaluation.
- Keep `archive/harness-3-2026-08-15` unchanged as the recovery baseline.
- Use `integration/nitsuga-taskdesk` for all integration work.
- Preserve contributor provenance wherever practical.
- Integrate by functional blocks, not wholesale branch merges.
- Run tests after every block.
- Treat real end-to-end behavior as the promotion gate, not only unit tests.

## Architecture rule: keep decomposing the client

The archived line already moved substantial UI/runtime code out of `App.tsx` into modules such as `components/panels.tsx`, `components/session-composer.tsx`, `components/session-list.tsx`, `components/shell.tsx`, backend modules, event handling, desktop bridge, agent-run helpers and storage helpers.

That direction is mandatory. `App.tsx` is still large, so new stabilization logic should not be pasted back into it when it can live in a pure module or focused hook/controller. In particular:

- concurrency primitives stay outside React;
- model/agent catalog loading belongs in dedicated helpers;
- task-first workflow state belongs in TaskDesk modules/components;
- OpenCode 2-specific behavior must not leak into generic client-state primitives.

## Repository relationship and lineage correction

### Merged Harness 3 archive

`archive/harness-3-2026-08-15` contains the Harness 3 work that actually landed before the rollback. It is the immutable recovery baseline.

### nitsuga continuation

`nitsuga:main` continued from the merged Harness 3 line before the rollback. Compared with the archive it was 94 commits ahead and 2 documentation/archive commits behind at the time of the audit.

Useful later work includes OpenCode 2 support, model/agent stale-response safeguards, session mutation coordination, richer activity states, background subagents, structured rendering, attention inbox, queued prompts, skills, compact/fork and todo reconstruction.

However, nitsuga's own roadmap still marks the task-first client UX as open. His fork is a continuation of the merged infrastructure line, not a finished TaskDesk client.

### Upstream PR #172

The full experimental task-first/New Task client was **not merged into the archive and was not inherited by nitsuga**. It remained in upstream PR #172 (`agent/task-control-plane-consolidated`). The final #172 client explicitly had the Task launch UI disabled after the problematic manual-testing period.

Therefore the correct reconstruction sequence is:

```text
archive merged baseline
  → generic stability ideas adapted from nitsuga
  → selective task-first restoration from upstream #172
  → isolated real-harness browser testing
  → normal-app compatibility testing
  → Android testing
  → only then consider normal UI exposure
```

## Phase 1 — Audit and stabilization

### 1.1 Inventory

Classify nitsuga's post-divergence work and relevant #172 slices into client-state/race fixes, session creation/refresh/reconciliation, model/agent loading, session mutation coordination, machine routing, task/worktree lifecycle, OpenCode 2 support, supervision state, background agents/subagents, attention inbox, queued prompts, docs/tests/maintenance, and unrelated/undesirable changes.

For each block record a decision: **Keep / Adapt / Drop / Defer**.

### 1.2 Previously observed TaskDesk regressions

Mandatory retest cases:

1. New-task model list must not time out or take an unreasonable amount of time.
2. First and subsequent attempts must behave consistently; no "fails first, works second" state leakage.
3. A newly started task/session must appear quickly enough to feel synchronous.
4. Opening the created task/session must show the correct model catalog and selected model.
5. Model/agent catalogs must be scoped to the correct machine/backend/agent/session/directory context.
6. Task creation and normal session creation must have clearly distinct UX and semantics.
7. No unnecessary backend/model discovery should run on every app start.

### 1.3 Coordinator review decisions

The imported nitsuga coordinator was useful as a reference but its original global-lock semantics were not suitable for TaskDesk. The integration version was adapted before React wiring:

- no global mutation lock; locks are scoped by target session and lane;
- run work serializes only where necessary;
- abort/question/permission remain available while run work is active;
- rename/delete serialize only for their target session;
- model and agent catalogs are reads, not mutations;
- explicit `reset()` provides recovery;
- React integration must keep one persistent instance in `useRef`;
- targeted operations are not invalidated merely by unrelated navigation;
- context values are copied rather than exposed through aliasing;
- OpenCode 2 fork-specific generation semantics are deferred until Compact/Fork is evaluated.

### 1.4 Catalog stale-response guard

Model/agent request validity is a separate read-side concern. The dedicated catalog guard scopes requests by profile, config/backend namespace, target session, directory/worktree and monotonically increasing request id. Older results must never replace the current picker.

This guard remains separate from mutation locking.

## Phase 2 — Restore a testable TaskDesk core

### 2.1 Machine endpoint resolution

A saved direct OpenCode endpoint and the machine daemon are different services. In the common local shape OpenCode is on 4096 while the TaskDesk daemon is on 4097. TaskDesk discovery must resolve the machine endpoint explicitly rather than assuming the saved session endpoint owns task APIs.

### 2.2 Machine/agent-level model discovery

New Task must not require an existing user session merely to discover models.

Current integration direction:

- `GET /v1/agents/:id/models` on the machine daemon;
- ACP model discovery through a separate ACP client and one durable prompt-less catalog session;
- managed OpenCode/HTTP discovery through `/config/providers`;
- stale cached catalog may be displayed with an explicit stale/error marker;
- selected model is persisted on the task;
- launch revalidates the selected model against a fresh catalog;
- disappeared models fail clearly instead of silently falling back;
- selected model is applied to the created ACP or HTTP/OpenCode session.

### 2.3 Isolated TaskDesk test surface

Do **not** re-enable New Task in the normal application yet.

The integration branch exposes an explicit browser test entrypoint:

```text
/?taskdesk-test=1
```

It renders the task launch workflow outside `App.tsx` and uses the normally saved active profile. This lets us test machine → project → model → task → worktree → launch without exposing the experimental workflow to ordinary users.

Detailed procedure: `docs/TASKDESK_LOCAL_TEST_PLAN.md`.

### Phase 2 gate

Before feature integration proceeds:

- browser-local TaskDesk flow works against real harnesses;
- first/second New Task behavior is equivalent;
- model discovery does not depend on a user session;
- selected model is the model actually launched;
- create/worktree/launch timing is acceptable and observable;
- normal Harness Remote session behavior still works against the same daemon;
- all remaining failures have reproducible evidence and a next action.

## Phase 3 — Supervision layer

After the core task path is reliable, evaluate nitsuga blocks independently:

1. richer session activity/attention states;
2. structured message/tool rendering;
3. background subagents/delegated tasks;
4. cross-session attention inbox;
5. queued-prompt visibility and controls.

Each block gets a Keep/Adapt/Drop/Defer decision and its own regression pass.

## Phase 4 — OpenCode 2

Only after baseline TaskDesk stability, evaluate OpenCode 2 base support, bare-response fixes, skills, compact/fork, todo reconstruction and other roadmap items.

OpenCode 2 remains a parallel backend until replacing an existing path is proven safe and desirable.

## Phase 5 — Finish and expose TaskDesk client UX

Target product flow:

```text
project
  → task
  → agent
  → model
  → prepare/start isolated worktree
  → run/session
  → inspect result
  → finish safely
```

Required client behaviors include project selection, explicit agent/model selection, task entry, worktree preparation/start, immediate run/session visibility, correct context, result inspection, cleanup/failure recovery, finish semantics, and a clear distinction between tasks and ordinary sessions.

Only at this phase should we consider putting New Task back into the normal UI.

## Validation matrix

### Automated

- TypeScript build/type-check;
- web/UI/model/settings/config/event regressions;
- catalog request guard tests;
- session mutation coordinator tests;
- machine payload/routing tests;
- agent model catalog/server tests;
- task/worktree/run/finish tests;
- bridge tests on Linux, macOS and Windows;
- Electron/APK build where relevant.

### Real-PC browser gate

On the PC with real harnesses:

1. start the machine daemon;
2. start Vite locally;
3. configure/save the daemon profile in the normal app;
4. open `/?taskdesk-test=1`;
5. inspect `/v1/projects` and `/v1/agents/<agent>/models` latency;
6. repeat first vs second attempt;
7. create a task with an explicit model;
8. prepare a worktree where appropriate;
9. launch;
10. confirm the selected model is actually used;
11. create a second task and check state isolation;
12. reload browser and restart daemon separately;
13. remove the query string and verify normal session behavior.

### Android gate

Only after the real-PC browser flow is reliable, connect a debug APK to the same PC daemon and repeat compatibility and task-flow tests as appropriate. New Task remains hidden in the normal mobile UI until the isolated workflow has passed its gates.

### Real harness coverage

Where behavior is ACP-backed, test real ACP harnesses rather than relying only on doubles. Repeat the daemon with multiple available ACP primaries (Codex, Claude, OMP, PI where installed) and test managed OpenCode as well.

## Promotion criteria

No proposal to replace stable `main` until:

- required automated tests are green;
- real-PC browser TaskDesk flow passes with evidence;
- normal-app backward compatibility passes;
- Android debug build has been tested;
- rollback regressions are explicitly marked pass/fail;
- no unresolved high-severity integration bug remains;
- final diff against stable `main` is reviewed for scope and compatibility;
- TaskDesk UX is coherent enough to expose intentionally.

## Decision log

Use issue #197 as the operational checklist and decision log. For each imported block record source PR/commit(s), Keep/Adapt/Drop/Defer, integration commits, tests run, manual result, regressions found and next action.

Update this document whenever sequencing, integration policy, lineage understanding or architectural guardrails change.
