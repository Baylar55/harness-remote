# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after the relevant CI is completely green and the repository owner explicitly authorizes the merge after real validation.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over new source-text guards.
- Do not publish comments/reviews on external contributor PRs unless explicitly requested by the repository owner.
- Do not ask the repository owner to manually validate a candidate until code/diff review and all applicable automated gates are already green.

## Current integration baseline

- Integration head after PR #516: `8976507c5ce4d511719db9d0fc8424430f5c710f`.
- `web/package.json` is `3.1.0`.
- PR #511 marked the Harness Remote 3.1.0 release-readiness boundary.
- PR #513 integrated the first OpenCode Session-rail lifecycle fix: a Session that completed while another Session was selected could remain visually `Working` until reopened.
- PR #515 prepared 3.1.0 release metadata only.
- PR #516 fixed the RC1 desktop startup loop caused by semantically unchanged embedded-runtime polling repeatedly restarting slower machine discovery.

The integration line is in **3.1.0 release-candidate stabilization**. Do not start opportunistic feature work while release blockers remain.

## RC1 result — failed, blocker fixed in integration

Frozen RC1 branch: `codex/release-candidate-3.1.0` at `a5695af0c874deeb2934f8308bc78f2196b5be1c`.

Real desktop testing exposed a release blocker: when the embedded local runtime was healthy and another saved machine endpoint was slow/unreachable, the app could remain on `Connecting to your machines…` indefinitely even though the local machine was already usable.

Root cause:

- 3.1 introduced the desktop-owned local runtime and polls its state after startup;
- Electron IPC returned a fresh object for every `getLocalRuntimeState()` call even when semantic state was unchanged;
- that rebuilt the composed machine array;
- Native Session discovery keyed work by that array identity, so repeated local-runtime polling could cancel and restart slower remote discovery before it settled offline.

PR #516 fixed this by preserving referential identity for semantically unchanged desktop local-runtime state while still detecting real status/profile/host/port/PID changes. Keep RC1 frozen as failed evidence; do not rewrite its history.

## RC2 result — failed OpenCode real validation

After the RC1 startup fix, real OpenCode testing exposed a second release blocker cluster:

- prolonged generic `OpenCode is getting started` / unexplained retry presentation;
- Working/Retrying transitions that lost the provider's actual retry reason;
- terminal-looking `session.error` becoming visible only after navigation or a later turn;
- stale live errors surviving after the native transcript had already persisted a successful final answer;
- Ready/empty or stale rail presentation after leaving and reopening Sessions;
- lifecycle authority collisions between an unscoped machine stream and the agent-routed OpenCode Session path.

PR #517 initially closed those synthetic/browser regressions and reached exact-head automated green at `9a09b50afb504834df8743418f5ce99ff12e896f`, but repository-owner testing on real Zorin/OpenCode immediately exposed two additional blockers that the old campaign had missed:

1. a user turn could reach `Ready` while Harness Remote displayed OpenCode reasoning/activity text instead of a normal final assistant answer;
2. a second Send in the same Session could then stall without producing a response.

Treat `9a09b50` as failed real-validation evidence. Its previous green CI is not release-readiness evidence.

## Active OpenCode stabilization — PR #517

- branch: `codex/opencode-rc3-stabilization`;
- PR: **#517** `fix(opencode): stabilize retry, error and remount lifecycle`;
- target: `codex/development-2026-09-11` only;
- PR remains **draft**;
- latest runtime head before this handoff/documentation update: `2270c26cd81600cb4932f530db0158a11653c928`;
- do **not** merge #517 and do **not** create RC3 until a complete exact-head automated campaign is green and the repository owner then confirms a fresh real OpenCode validation.

Current #517 design preserves the earlier lifecycle fixes and adds real-runtime completion semantics:

- preserves OpenCode `session.status` retry message/attempt/next metadata;
- bridges `session.error` across short persistence/navigation gaps without making it permanent;
- later real `busy`/`retry` or durable successful assistant output retires an older live error;
- selected-detail streams never own shared rail lifecycle state;
- lifecycle cache identity includes routed `agentId`, so sibling agents cannot contaminate one another;
- the rail receives lifecycle only from an agent-routed OpenCode stream, never from an ambiguous machine-primary stream;
- there is exactly one routed lifecycle owner per available OpenCode agent: the existing Attention stream when question/permission capability is present, otherwise the Session-rail fallback stream;
- the Session-rail fallback is OpenCode-only and only for `available` agents; configured/unavailable/starting/error OpenCode agents are not awakened by opening the rail;
- permission/question acknowledgement keeps the pre-existing immediate reconcile for every backend and adds exactly one bounded trailing reconcile only for OpenCode, covering the ACK-before-durable-final race without changing ACP behavior;
- an OpenCode assistant envelope with `finish: "stop"` is **not** completion proof unless it also contains durable terminal assistant text; reasoning-only output cannot produce a false successful `Ready`;
- after a Send, reasoning-only/no-final state remains pending until a durable final/error settles it or bounded recovery proves native idle without a final;
- stable idle with no durable final becomes an explicit failure (`OpenCode ended this request without a response...`) rather than false `Ready` or a wedged second Send;
- managed POSIX OpenCode process teardown now terminates descendants and restart is blocked while shutdown is still in progress, preventing overlapping managed runtimes during live-gate restart;
- per-agent rail discovery is bounded so a slow/unavailable sibling harness cannot indefinitely restart or contaminate OpenCode rail state;
- ACP semantics remain on their established adapter/transcript paths and do not inherit OpenCode `session.error`, durable-final or delayed-attention settlement behavior;
- no continuous `/session/status` polling was added, preserving #351 and #421/#422 behavior.

### Behavioral coverage added/strengthened

Blocking browser coverage includes the historical OpenCode matrix plus:

- `native-opencode-rail-state-smoke.mjs` — background Working → Ready without reopen;
- `native-opencode-retry-error-smoke.mjs` — retry detail, navigate-away error, recovery, second Send and durable settlement;
- `native-opencode-unmounted-durable-smoke.mjs` — true error survives reopen, but a durable final written while unmounted wins when reopened;
- `native-opencode-multiturn-stress-smoke.mjs` — six sequential turns covering normal completion, retry, provider error/recovery, remount and background completion with one native dispatch and one final reply per turn;
- reasoning-only/no-final adapter regressions — `finish: stop` without terminal text must not settle success, historical no-final/error semantics remain preserved, and the second Send cannot be left wedged;
- OpenCode permission regression — unresolved Attention, exact reject/once mapping, in-place settlement and failed-reply fail-closed behavior;
- slow-harness/per-agent discovery isolation;
- the existing navigation, model, outcome, cross-machine continuation and complete-controls product smokes.

A dedicated **real OpenCode + Zen browser gate** now installs a pinned real OpenCode build, probes a responsive Zen model, creates and seeds an OpenCode Session outside the UI, then verifies Harness Remote against that existing Session. It performs multiple UI continuations, rejects `Ready` when the requested output exists only in reasoning/activity, verifies durable final rendering, reload/remount, selected-model recovery, a full daemon/managed-OpenCode restart, another continuation, no duplicate/pending final rows and no stale Working/activity state.

### Current automated evidence

Runtime head `2270c26cd81600cb4932f530db0158a11653c928` has the following verified evidence:

- **OpenCode live Zen gate #34 / Actions `35185507650`: green**, including the pinned real OpenCode existing-Session release gate and sanitized runtime evidence;
- **Desktop runtime/menu #1241 / Actions `35185507542`: green** on Ubuntu, macOS and Windows, including packaged embedded-daemon execution on the applicable platform and the macOS application menu check;
- **PR checks #2100 / Actions `35185507567`: not yet acceptable as release evidence**. Type-check/build, web regressions, OpenCode permission transport and bridge tests are green. The first Chromium product-smoke attempt passed the complete OpenCode matrix, including the real-regression, permission, rail-state, retry/error, unmounted-durable and six-turn stress smokes, then failed the pre-existing cross-machine continuation assertion that the selected target Project must survive target model-catalog revalidation (`actual: ""`, expected `project-cross-match`). The cross-machine smoke itself was not changed by the post-`9a09b50` stabilization commits. A same-SHA Chromium rerun was started to distinguish a latent timing flake from a reproducible product regression; do not weaken that assertion if it fails again.

Because this documentation commit moves the feature-branch head, **all applicable gates must be green again on the new exact SHA before asking the repository owner for another real OpenCode test**. A green rerun on `2270c26` alone is not sufficient after this documentation update.

## Stable `main` line

- `main` remains on Harness Remote 3.0.2 at `21ce6db49af708c4c7c3f96ef6a50f62dced8dab` and has not been modified by the 3.1 work.
- Stable-line PR #512 contains the OpenCode rail-state fix adapted to the 3.0 shell.
- #512 remains outside the 3.1 stabilization path. Do not merge it into `main` without explicit authorization.
- The RC1 desktop startup loop and #517 RC stabilization work belong to the 3.1 line; do not backport them opportunistically.

## OpenCode reliability guardrails

Read `docs/OPENCODE_RELIABILITY_CONTRACT.md` before changing OpenCode Session projection, lifecycle routing or reconciliation. Do not regress behavior established by #304/#306/#337/#351/#355/#391/#421/#422/#425/#451/#452/#453/#513.

In particular:

- ordinary internal idle/pre-Send OpenCode must not depend on `/session/status` (#351);
- persisted replies must remain recoverable even when event delivery or status lookup is unavailable (#421/#422/#425);
- permission and mounted-Session convergence must not create false red interruptions (#452);
- unresolved requests remain Attention rather than being silently treated as completed (#451);
- OpenCode lifecycle overlays are presentation bridges, not a second durable transcript/state machine;
- routed OpenCode lifecycle must not leak into ACP backends or sibling agent identities;
- `finish: "stop"` on a reasoning-only assistant envelope is not successful turn completion;
- a stable native idle edge after Send is enrichment, not durable-final proof;
- the OpenCode permission/question settle fallback may add one bounded trailing read, but ACP keeps its existing immediate-only resolution path.

## CI / packaging

The release-candidate gate is not satisfied by unit/type-check alone. Before integration or RC freeze require, on the **exact candidate SHA**:

- type-check/build and web regressions;
- OpenCode permission transport regression;
- bridge tests on Windows and macOS;
- Chromium product smoke including the complete OpenCode reliability matrix and cross-machine scenarios;
- real OpenCode + Zen existing-Session gate;
- desktop tests on Ubuntu, macOS and Windows, including packaged embedded-daemon execution where applicable;
- signed Debug APK.

Android CI was previously repaired so `android-actions/setup-android@v4` no longer requests the retired SDK `tools` package; Android 36 packages are installed explicitly. There is no push-triggered workflow on the integration branch, so PR validation is the applicable gate before merge.

## External PRs

- PR #494 (`Mimocode`) was closed without merge after real validation showed its primary product behavior was not delivered when OpenCode and Mimocode coexist.
- PR #504 (`custom ACP primaries`) is not part of the 3.1.0 candidate. Re-review only with coherent end-to-end parse/start behavior and executable coverage of the actual boundary.

## Release boundary

The intended next release is **Harness Remote 3.1.0**, not 3.0.3.

Do not freeze RC3 from the old `9a09b50` candidate or from `2270c26` merely because the new live gate is green. The next eligible candidate is the final exact feature-branch head after documentation/handoff is current and the entire automated campaign is green. Only then ask the repository owner to repeat the real Zorin/OpenCode sequence that failed `9a09b50`. Merge #517 into `codex/development-2026-09-11` only after that real validation succeeds and the owner explicitly authorizes it. `main` remains untouched.

After #517 is cleared, remaining release evidence still includes true-boundary validation:

- strict real-harness checks against installed OpenCode/Codex/Claude/OMP/PI builds, recording unavailable harness/model combinations rather than inventing substitutes;
- real daemon/adapter restart plus persisted-Session resume/claim;
- physical Android foreground/background and real network interruption/reconnect;
- repository-admin enforcement on `main` requiring pull requests and required checks. The connected GitHub App cannot perform that administration write.

## Roadmap boundaries

### P0 — issue #368

Keep open for the true-boundary release evidence and repository-admin enforcement above. Do not add synthetic tests as substitutes for those checks.

### P1 — issue #369

Repo-side pairing, Attention semantics, desktop-owned local runtime, packaged-runtime execution, PATH recovery, health/reconnect recovery and Machines simplification are implemented. Release readiness still depends on the RC stabilization and P0 true-boundary evidence.

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
