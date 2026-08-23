# Harness Remote 3.0 independent product and UI audit

This branch is the independent product/UI workstream for the final Harness Remote 3.0 pre-merge audit.

## Start here

Read these completely before modifying code:

1. issue #197, canonical Harness Remote 3.0 product plan;
2. issue #287, backend/reliability audit and its latest comments;
3. issue #289, parallel pre-merge audit contract;
4. draft PR #286, conversation-first beta;
5. draft PR #288, frozen backend audit baseline and latest discussion;
6. the current code on this branch.

This branch started from frozen baseline:

`56c5c9d925045fbef542650c6d564ce502c72758`

## Product direction

The product is **Harness Remote 3.0**.

Do not present it as TaskDesk and do not redesign it as a task manager.

The user model is conversation-first:

```text
Project
  Conversation / Work Thread
    Native Session
    Native Session
    ...
```

A Conversation is persistent work continuity above real native harness Sessions and may continue across OpenCode, Codex, Claude, OMP and PI.

Existing internal `task*` names, storage fields and compatibility routes may remain when renaming them would create unnecessary risk. New user-facing language should use Conversation, Work Thread, Project, Session, coding agent and Harness Remote 3.0.

## Your job

Audit the product critically before changing code. Do not assume the current UI is correct because automated tests pass.

### Product and information architecture

Check whether a new user can understand:

- what a Project is;
- what a Conversation is;
- how a Conversation differs from a native Session;
- how to start a Conversation;
- how to Continue with another harness/model;
- where Machines, Projects, Sessions and Changes belong;
- what is running, ready, stopped, failed or waiting for attention.

Find remaining TaskDesk/task-manager assumptions in visible UI and copy. Distinguish safe user-facing renames from risky internal protocol refactors.

### UX/UI audit

Audit desktop, browser and Android behavior, including:

- typography and visual hierarchy;
- spacing and density;
- responsive layout;
- navigation and mobile drawer behavior;
- New Conversation flow;
- machine/project/harness/model selection;
- loading, empty, offline, retry and error states;
- Conversation transcript readability;
- composer responsiveness and typing latency;
- working/Stop/attention feedback;
- Continue with flow;
- Sessions and Changes presentation;
- settings consistency;
- accessibility, focus, labels and touch targets;
- unnecessary visual complexity;
- stale UI state after switching machine/project/harness;
- unnecessary renders or effects that can make typing/scrolling slow.

### Code-level product audit

Look for concrete bugs and maintainability problems in UI-facing code:

- state races;
- stale closures;
- accidental duplicate requests;
- expensive render paths;
- effects with unstable dependencies;
- unnecessary polling;
- stale selection leakage;
- local state that disagrees with authoritative backend state;
- UI behavior that makes a recoverable backend condition look fatal;
- inconsistent web/Android/Desktop behavior.

## Allowed changes

You may implement well-scoped product/UI fixes and additions on this branch.

Prefer small, reviewable commits. Add regression tests where practical. Keep existing behavior when you cannot prove a replacement is safer.

Before implementing a large redesign, document the problem and why the change is needed in the PR.

## Backend ownership boundary

Do not casually change the backend reliability contract owned by #287 and the parallel `audit/v3-capability-contract` workstream.

In particular, do not independently redesign:

- model discovery authority;
- model/cache ownership;
- ACP/HTTP transport protocol;
- native Session lifecycle;
- accepted-prompt idempotency;
- Stop semantics;
- reconnect semantics;
- daemon diagnostics;
- OpenCode event fanout ownership.

If a UI fix genuinely requires a backend contract change, document it in #289 and keep the UI change isolated until the dependency is reviewed.

## Hard safety constraints

- NEVER touch `main`.
- NEVER modify `v3/taskdesk` directly.
- NEVER delete or rewrite `archive/harness-3-2026-08-15`.
- Do not modify `fix/v3-backend-reliability-audit`; it is the frozen common baseline.
- Do not modify `audit/v3-capability-contract`.
- Do not merge #286, #288 or your own PR.
- Do not force-push or rewrite shared history.
- Treat #279, #281 and #283 as historical reference only.

## Expected output

Your draft PR should maintain a running audit summary with:

1. findings ranked by severity and user impact;
2. fixes implemented;
3. proposed improvements intentionally not implemented;
4. screenshots or clear reproduction steps where useful;
5. tests added/run;
6. known dependencies on the capability/backend workstream;
7. a final list of user-facing TaskDesk/task terminology still present and whether each instance should be renamed now or later.

## Branch hygiene

Repository branch cleanup is a separate task tracked by #290.

Do not delete branches while doing the product/UI audit. If asked to perform branch cleanup later, follow #290 exactly: inventory first, delete only after classification and review.

Refs #197
Refs #287
Refs #289
Refs #290
Refs #286
Refs #288
