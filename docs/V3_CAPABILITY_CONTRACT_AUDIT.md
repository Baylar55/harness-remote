# Harness Remote 3.0 capability contract audit

This branch is the backend/capability workstream for the final Harness Remote 3.0 pre-merge audit.

Frozen shared baseline:

`56c5c9d925045fbef542650c6d564ce502c72758`

## Goal

Make the per-harness capability contract explicit and make discovery/cache identity correctly project-aware without disturbing the already-validated reliability fixes.

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

## Project/cwd-aware discovery

Where model/provider configuration can be project-scoped, model/capability discovery and single-flight/cache identity must include validated project/cwd in addition to machine + harness.

Carry the selected project/workspace directory end to end from the UI to the daemon.

Do not accept arbitrary filesystem paths supplied by a client. Resolve/validate the requested directory against configured/discovered project roots and reject paths outside allowed roots.

New Conversation should use its selected Project path. Existing Conversation should use the authoritative Work Thread workspace path.

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

## Validation

Add regressions for at least:

- cache isolation between two project/cwd values for the same machine+harness;
- concurrent same-scope requests joining one operation;
- different-scope requests not sharing the wrong catalog;
- invalid/out-of-root directory rejection;
- capability snapshot/contract shape per harness profile;
- first-selection loading/errors surfacing as capability/discovery state rather than generic disconnect where possible.

Then run the existing bridge/web suites and real-harness validation from one exact final SHA.

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
