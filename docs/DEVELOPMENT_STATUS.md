# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after the relevant CI is completely green.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over new source-text guards.
- Do not publish comments/reviews on external contributor PRs unless explicitly requested by the repository owner.

## Current integration baseline

- Integration head after release-prep PR #515: `a5695af0c874deeb2934f8308bc78f2196b5be1c`.
- `web/package.json` is now `3.1.0`.
- PR #511 marked the Harness Remote 3.1.0 release-readiness boundary.
- PR #513 integrated the OpenCode Session-rail lifecycle fix discovered during real testing: a Session that completed while another Session was selected could remain visually `Working` until reopened.
- PR #514 refreshed the development handoff after #513.
- PR #515 prepared 3.1.0 release metadata only; no runtime behavior changed.

The integration line is in **3.1.0 release-candidate stabilization**. Do not start opportunistic feature work while release blockers remain.

## RC1 result — failed

Frozen RC1 branch: `codex/release-candidate-3.1.0` at `a5695af0c874deeb2934f8308bc78f2196b5be1c`.

Real desktop testing exposed a release blocker: when the embedded local runtime is healthy and another saved machine endpoint is slow/unreachable, the app can remain on `Connecting to your machines…` indefinitely even though the local machine is already usable.

Root cause:

- 3.1 introduced the desktop-owned local runtime and polls its state every 4 seconds after startup;
- Electron IPC returns a fresh object for every `getLocalRuntimeState()` call even when semantic state is unchanged;
- `main.tsx` feeds that fresh state into React, rebuilding the composed `machines` array;
- `NativeSessionsWorkspace` keys machine discovery by that array identity, so every 4-second poll cancels and restarts any slower remote discovery before it can settle offline;
- the Session rail waits for configured machine discovery to settle, so the UI can remain in the startup phase forever.

This explains why the issue did not occur on 3.0.2: that line had no automatic embedded-local-runtime polling. It also explains why the failure is indefinite rather than merely one 30-second Electron request timeout.

Active fix branch: `codex/fix-startup-offline-machine`.

Fix direction:

- preserve referential identity for semantically unchanged `DesktopLocalRuntimeState` values in `desktopBridge.ts`;
- still return a new state when status, profile id, host, port or PID actually changes;
- behavioral coverage in `desktop-workspace-bridge.test.mjs` asserts both unchanged-state stability and real restart detection;
- do not weaken offline-machine visibility or hide saved unreachable machines.

RC1 must remain frozen as failed evidence. Cut RC2 only after this fix passes the complete PR gate and merges into integration.

## Stable `main` line

- `main` remains on Harness Remote 3.0.2 and has not been modified by the 3.1 work.
- Stable-line PR #512 contains the OpenCode rail-state fix adapted to the 3.0 shell.
- #512 is fully green but remains **open and unmerged**. Do not merge it into `main` without explicit authorization.
- The RC1 startup loop is specific to the 3.1 desktop-owned local-runtime polling path; 3.0.2 does not contain that mechanism.

## OpenCode reliability guardrails

Do not regress behavior established by #304/#306/#337/#351/#355/#391/#421/#422/#425/#451/#452/#453.

In particular:

- ordinary internal idle/pre-Send OpenCode must not depend on `/session/status` (#351);
- persisted replies must remain recoverable even when event delivery or status lookup is unavailable (#421/#422/#425);
- permission and mounted-Session convergence must not create false red interruptions (#452);
- unresolved requests remain Attention rather than being silently treated as completed (#451);
- PR #501 extracted deterministic OpenCode assistant-envelope classification without changing the stateful #351 lifecycle.

## CI / packaging

- #513/#514/#515 completed the normal release-candidate gate: type-check/regressions, OpenCode permission transport, bridge macOS/Windows, Chromium product smoke including cross-machine scenarios, desktop Ubuntu/macOS/Windows and signed Debug APK.
- Android CI was previously repaired so `android-actions/setup-android@v4` no longer requests the retired SDK `tools` package; Android 36 packages are installed explicitly.
- There is no push-triggered workflow on the integration branch, so PR validation is the applicable gate before merge.

## External PRs

- PR #494 (`Mimocode`) was closed without merge after real validation showed its primary product behavior was not delivered when OpenCode and Mimocode coexist.
- PR #504 (`custom ACP primaries`) is not part of the 3.1.0 candidate. Re-review only with coherent end-to-end parse/start behavior and executable coverage of the actual boundary.

## Release boundary

The intended next release is **Harness Remote 3.1.0**, not 3.0.3.

After the RC1 startup blocker is fixed and RC2 is frozen, remaining release evidence is true-boundary validation:

- strict real-harness checks against installed OpenCode/Codex/Claude/OMP/PI builds, recording unavailable harness/model combinations rather than inventing substitutes;
- real daemon/adapter restart plus persisted-Session resume/claim;
- physical Android foreground/background and real network interruption/reconnect;
- repository-admin enforcement on `main` requiring pull requests and required checks. The connected GitHub App cannot perform that administration write.

## Roadmap boundaries

### P0 — issue #368

Keep open for the true-boundary release evidence and repository-admin enforcement above. Do not add synthetic tests as substitutes for those checks.

### P1 — issue #369

Repo-side pairing, Attention semantics, desktop-owned local runtime, packaged-runtime execution, PATH recovery, health/reconnect recovery and Machines simplification are implemented. Its remaining dependency is P0 evidence plus the RC1 startup blocker fix.

### P2 — issue #371

Do not redo already-integrated federation/cross-machine continuity:

- #411-#413: federated Native Session read model and operational scopes;
- durable Project/native identity, lineage, portable handoff and crash/retry-safe target creation/first prompt;
- #435/#436: recovered portable state and source-authority invalidation;
- #437-#439/#469: bounded Project/outcome evidence and Git aggregates;
- #471/#472: blocking Chromium planning and full cross-machine execution coverage.

Do not infer `checks run/failed` from transcript/tool prose. There is no provider-neutral structured source yet.

## Product direction

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.