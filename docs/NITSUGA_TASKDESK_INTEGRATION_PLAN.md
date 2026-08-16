# Nitsuga → TaskDesk Integration Plan

> **Status:** active integration plan
>
> **Working branch:** `integration/nitsuga-taskdesk`
>
> **Baseline:** `archive/harness-3-2026-08-15`
>
> **Tracking issue:** #197

## Goal

Safely evaluate and integrate the work in `nitsuga/harness-remote` that continued from the Harness 3 / TaskDesk codebase before upstream `main` was rolled back to the stable line.

The objective is not to merge the fork wholesale. The objective is to recover valuable fixes and product work in coherent blocks, verify them against the regressions that triggered the rollback, and only then decide what should become the next TaskDesk line.

## Non-negotiable safety rules

- Do not modify or merge into `main` during evaluation.
- Keep `archive/harness-3-2026-08-15` unchanged as the recovery baseline.
- Use `integration/nitsuga-taskdesk` for all integration work.
- Preserve contributor provenance wherever practical.
- Integrate by functional blocks, not by merging `nitsuga:main` wholesale.
- Run tests after every block.
- Treat real end-to-end behavior as the promotion gate, not only unit tests.

## Architecture rule: keep decomposing the client

The archived TaskDesk line already moved substantial UI/runtime code out of `App.tsx` into modules such as `components/panels.tsx`, `components/session-composer.tsx`, `components/session-list.tsx`, `components/shell.tsx`, backend capability/client/setup modules, event handling, desktop bridge, agent-run helpers and storage helpers.

That direction is mandatory for the integration line. `App.tsx` is still large, so new stabilization logic should not be pasted back into it when it can live in a pure module or focused hook/controller. In particular:

- concurrency primitives stay outside React;
- model/agent catalog loading should move toward a dedicated state/loading helper rather than growing `App.tsx`;
- task-first workflow state should be implemented in dedicated TaskDesk modules/components;
- OpenCode 2-specific behavior must not leak into generic client-state primitives.

## Repository relationship

The fork continued from the Harness 3 line before the upstream rollback.

Compared with `archive/harness-3-2026-08-15`, `nitsuga:main` is currently 94 commits ahead and 2 commits behind. The two upstream-only commits are archive/documentation changes, so the code comparison is effectively a continuation of the same product line.

The fork has advanced OpenCode 2 support, model/agent loading safeguards, session mutation coordination, richer session activity states, background subagent visibility, structured message/tool rendering, a cross-session attention inbox, queued prompt controls, skills, compact/fork and todo reconstruction.

However, the fork's own Harness 3 roadmap still marks the task-first client UX as open. The task/worktree backend foundations exist, but the full TaskDesk client workflow is not complete.

## Phase 1 — Audit and stabilization

### 1.1 Inventory

Classify the fork's 94 commits/PRs into client-state/race fixes, session creation/refresh/reconciliation, model/agent loading, session mutation coordination, OpenCode 2 base support, supervision state, background agents/subagents, attention inbox, queued prompts, task/worktree UX, docs/tests/maintenance, and unrelated/undesirable changes.

For each block record a decision: **Keep / Adapt / Drop / Defer**.

### 1.2 Previously observed TaskDesk regressions

These are mandatory retest cases:

1. New-task model list must not time out or take an unreasonable amount of time.
2. First and subsequent attempts must behave consistently; no "fails first, works second" state leakage.
3. A newly started task/session must appear quickly enough to feel synchronous.
4. Opening the created task/session must show the correct model catalog and selected model.
5. Model/agent catalogs must be scoped to the correct backend, session and directory.
6. Task creation and normal session creation must have clearly distinct UX and semantics.
7. No unnecessary backend/model discovery should run on every app start.

### 1.3 Coordinator review decisions

The first imported coordinator was useful as a reference but its original global-lock semantics were not suitable for TaskDesk. Before any React wiring, the integration version is adapted as follows:

- **No global mutation lock.** Locks are scoped by target session and lane.
- **Run lane:** prompt/command/skill/history/compact/fork serialize for the same session.
- **Control lane:** abort/question/permission/inbox can remain available while run work is active.
- **Metadata lane:** rename/delete serialize only for the same target session, so another session can still be managed.
- **Create lane:** session creation is isolated from existing-session run work.
- **Model and agent catalogs are reads, not mutations.** They do not acquire leases. They use request-id plus profile/config/session/directory generation validation.
- **Explicit recovery:** the coordinator exposes `reset()` for lifecycle teardown or recovery from an async owner that will never release.
- **Persistent instance:** React integration must keep one coordinator instance in `useRef`; it must not be recreated on dependency changes.
- **Targeted operations survive navigation:** an explicit rename/delete on another session is not invalidated merely because the user changes the selected session.
- **Context values are copied:** callers cannot mutate coordinator-owned context through object aliasing.
- The OpenCode 2 fork-specific generation mechanism is deferred until Compact/Fork is integrated and justified by that feature's real requirements.

### 1.4 First stabilization candidates

Prioritize fork changes that improve stale model/agent response rejection, explicit destination scoping (`sessionID`, `directory`), invalidation of older model/agent loaders after manual changes, session refresh/reconciliation, session creation/open race handling, and safe mutation coordination.

Do not require OpenCode 2 integration merely to obtain generic stability fixes unless the dependency is unavoidable.

## Phase 2 — Integrate client-state stabilization

Port only the minimum coherent subset needed for baseline stability.

The first runtime wiring target is **model/agent catalog correctness**, but it should be implemented as a focused helper/module where practical rather than adding another large state machine directly to `App.tsx`.

Required semantics:

- a loader captures profile, config/backend, target session and directory;
- only the latest request for that logical catalog may publish results;
- navigation/profile/backend changes invalidate stale results;
- manual model/agent changes invalidate older loaders where necessary;
- session creation reloads catalogs against the newly created session/directory explicitly;
- a concurrent mutation must never cause a catalog read to be silently skipped.

After each block:

- run web regression suites;
- run TypeScript type-check/build;
- run bridge tests if affected;
- inspect the diff for accidental OpenCode 2 coupling;
- inspect whether `App.tsx` grew unnecessarily;
- record the result in issue #197.

### Phase 2 gate

Before feature work proceeds:

- baseline TaskDesk creation/open/model flow must be more reliable than the archived branch;
- none of the known regressions may remain unexplained;
- any remaining failure must have a reproducible issue and an owner/next action.

## Phase 3 — Supervision layer

Evaluate as separate integration blocks: richer session activity/attention states, structured message/tool rendering, background subagents, cross-session attention inbox, and queued-prompt visibility/controls.

For each block decide whether the implementation is backend-neutral enough for TaskDesk or should remain OpenCode 2-specific.

## Phase 4 — OpenCode 2

Only after baseline stability is acceptable, evaluate the OpenCode 2 base client, bare-response fixes, skills, compact/fork, todo reconstruction, and other roadmap items that support the product direction.

OpenCode 2 should remain a parallel backend until there is evidence that replacing the existing OpenCode path is safe and desirable.

## Phase 5 — Finish TaskDesk client UX

Target flow:

```text
project
  → task
  → agent
  → prepare/start isolated worktree
  → run/session
  → inspect result
  → finish safely
```

Required client behaviors include project selection, task entry, explicit agent selection, worktree preparation/start, immediate run/session visibility, correct model/agent context, result inspection, cleanup/failure recovery, finish semantics, and a clear distinction between tasks and ordinary sessions.

## Validation matrix

### Automated

- web regressions;
- model regressions;
- UI regressions;
- settings/config regressions;
- event/status tests;
- session mutation coordinator tests;
- bridge tests;
- TypeScript build/type-check;
- Electron build when relevant.

### Manual Android gate

Build a debug APK from the integration branch and retest:

1. connect to the target backend;
2. open New Task;
3. select project/directory;
4. verify model/agent list latency and correctness;
5. create/start task;
6. verify immediate appearance;
7. open it;
8. verify selected model/agent and catalogs;
9. send work;
10. leave/reopen the session;
11. create a second task and verify no state leakage;
12. restart the app and verify startup behavior.

### Real harness gate

Where changes affect ACP-backed behavior, test at least one real harness end to end. Test doubles are not sufficient evidence for promotion.

## Promotion criteria

No proposal to replace stable `main` until all required automated tests pass, the Android debug APK passes the manual flow, rollback regressions are explicitly marked pass/fail with evidence, no unresolved high-severity integration bug remains, backward compatibility is reviewed, the final diff against stable `main` is reviewed for scope, and the TaskDesk task-first UX is coherent enough to expose intentionally.

## Decision log

Use issue #197 as the operational checklist and decision log. For each imported block record source PR/commit(s), Keep/Adapt/Drop/Defer, integration commits, tests run, manual test result, regressions found and next action.

Update this document when overall sequencing, integration policy or architectural guardrails change.
