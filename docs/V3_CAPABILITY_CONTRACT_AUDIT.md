# Harness Remote 3.0 capability contract audit

This document records the backend/capability workstream and the integration finding that changed its promotion scope.

Frozen shared baseline:

`56c5c9d925045fbef542650c6d564ce502c72758`

## Goal

Make the per-harness capability contract explicit without disturbing the already-validated reliability fixes.

The normalized model list is only one part of the contract.

## Required capability contract

For OpenCode, Codex, Claude, PI and OMP, expose/document where observable:

- transport/protocol;
- native Session create/resume/load/stop behavior;
- stream/event mechanism;
- tool-call representation;
- model catalog source;
- default/current model behavior;
- model variant/reasoning metadata;
- attachments/tool capability metadata where truly advertised;
- reconnect/retry behavior;
- lifecycle guarantees and known limitations;
- diagnostic observability.

Do not invent capabilities a harness does not advertise or support.

## Integration finding: project/cwd ACP discovery is deferred

The audit originally implemented project/cwd-scoped ACP model catalogs, with independent caches, single-flight operations and technical Sessions per authorized Project directory.

That design passed isolated tests with fake ACP adapters, but the integrated candidate failed the real-machine gate on Windows: PI, Codex and Claude all reported unavailable model catalogs, including in newly created Conversations. This is release-blocking evidence that the project/cwd experiment was not sufficiently validated for promotion.

The promotion candidate therefore restores the previously real-machine-validated ACP model discovery behavior:

```text
machine + harness
```

One daemon-owned prompt-less technical Session per ACP harness adapter lifetime supplies current `configOptions`. Discovery remains bounded and single-flight. Historical technical Session ids stay hidden and are not reloaded as current membership authority after restart.

The UI may continue to send `projectId` or `workThreadId` hints so a future compatible implementation does not require another client protocol change. In the promotion candidate those hints do not select ACP catalog authority. Raw client cwd is not accepted as model authority.

Project-aware discovery remains a follow-up and must be reintroduced only after real PI, Codex, Claude and OMP validation on the exact implementation, including Windows where practical.

## Reliability constraints

Preserve the fixes in #287/#288:

- daemon-owned model discovery;
- bounded discovery requests and polling;
- no duplicate native PI/OMP model-filter processes;
- no model-name blacklists;
- accepted-prompt idempotency;
- Stop reconciliation;
- OpenCode single upstream event fanout;
- Android reconnect behavior;
- bounded diagnostics and listener/subscriber ownership.

## Promotion-candidate validation

The candidate must now prove at least:

- one ACP catalog single-flight operation per harness;
- repeated callers cannot create unbounded technical catalog Sessions;
- PI, Codex, Claude and OMP requests share the stable machine-scoped ownership model;
- capability snapshot/contract reports the actual machine scope;
- first-selection loading/errors surface as capability/discovery state rather than generic disconnect where possible;
- all bridge tests pass on Linux, macOS and Windows;
- the production web build passes the full regression suite;
- a real Chromium smoke checks multi-machine navigation, portrait and phone-landscape layout, model controls and viewport containment;
- Android debug APK builds and verifies only after those gates pass.

Real installed-harness acceptance remains the final proof for credentials, provider inventory and native Session behavior. Automated simulation is not a substitute for installed PI, Codex, Claude, OMP and OpenCode runtimes.

## Safety

- NEVER touch `main`.
- NEVER modify `v3/taskdesk` directly.
- NEVER delete or rewrite `archive/harness-3-2026-08-15`.
- Do not modify the frozen `fix/v3-backend-reliability-audit` baseline.
- Do not modify `audit/claude-v3-product-ui`.
- Do not merge #286 or #288.

Refs #197
Refs #287
Refs #289
Refs #288
