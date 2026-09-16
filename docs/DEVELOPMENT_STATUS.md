# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after the relevant CI is completely green and the repository owner explicitly authorizes the merge.
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

Active stabilization:

- branch: `codex/opencode-rc3-stabilization`;
- PR: **#517** `fix(opencode): stabilize retry, error and remount lifecycle`;
- target: `codex/development-2026-09-11` only;
- status: **draft; automated OpenCode stabilization is green on the last runtime head, but do not merge and do not create RC3 without repository-owner confirmation and final exact-head validation**.

Current #517 design:

- preserves OpenCode `session.status` retry message/attempt/next metadata;
- bridges `session.error` across short persistence/navigation gaps without making it permanent;
- later real `busy`/`retry` or durable successful assistant output retires an older live error;
- selected-detail streams never own shared rail lifecycle state;
- lifecycle cache identity includes routed `agentId`, so sibling agents cannot contaminate one another;
- the rail receives lifecycle only from an agent-routed OpenCode stream, never from an ambiguous machine-primary stream;
- there is exactly one routed lifecycle owner per available OpenCode agent: the existing Attention stream when question/permission capability is present, otherwise the Session-rail fallback stream;
- the Session-rail fallback is OpenCode-only and only for `available` agents; configured/unavailable/starting/error OpenCode agents are not awakened by opening the rail;
- permission/question acknowledgement keeps the pre-existing immediate reconcile for every backend and adds exactly one bounded trailing reconcile only for OpenCode, covering the ACK-before-durable-final race without changing ACP behavior;
- ACP semantics remain on their established adapter/transcript paths and do not inherit OpenCode `session.error` presentation or delayed attention-settlement behavior;
- no continuous `/session/status` polling was added, preserving #351 and #421/#422 behavior.

Blocking browser coverage in #517 includes the historical OpenCode matrix plus:

- `native-opencode-rail-state-smoke.mjs` — background Working → Ready without reopen;
- `native-opencode-retry-error-smoke.mjs` — retry detail, navigate-away error, recovery and durable settlement;
- `native-opencode-unmounted-durable-smoke.mjs` — true error survives reopen, but a durable final written while unmounted wins when reopened;
- `native-opencode-multiturn-stress-smoke.mjs` — six sequential turns covering normal completion, retry, provider error/recovery, remount and background completion with one native dispatch and one final reply per turn.

The stabilization failures found during this campaign were treated as evidence rather than rerun blindly: an `agentId` cache/test identity mismatch, machine-level versus routed lifecycle namespaces, an overly broad routed subscription that touched ACP harnesses, a remount timing race in the stress smoke, and finally a native permission ACK race where the resumed final could become durable after the immediate refresh while the `permission.replied` edge was lost. The permission case is now closed by one OpenCode-only bounded trailing reconciliation; ACP retains its previous single resolution refresh.

### Automated stabilization evidence

Runtime head `4c97c85fd1d22e2c669ac725e7a423506d7e85e6` completed the entire automated campaign green:

- PR checks run **#2075** / Actions run `35123536146`:
  - type-check/build and full web regressions: green;
  - OpenCode permission transport regression: green;
  - bridge tests on macOS and Windows: green;
  - Chromium product smoke: green, including portrait/landscape/multi-machine, native Session transcript/composer, navigation, OpenCode retry/error/remount, permission regression, rail-state, unmounted durable completion, multi-turn stress, cross-machine continuation and complete controls/screenshot smoke;
  - Debug APK: green, including Android 36 setup, Capacitor sync, build, signature verification and artifact upload.
- Desktop runtime/menu run **#1216** / Actions run `35123536131`: Ubuntu, macOS and Windows all green, including packaged embedded-daemon execution on the applicable platform.

The runtime candidate is therefore the first post-RC2 head to satisfy the complete automated OpenCode stabilization gate. Documentation/handoff commits are non-runtime changes but still move the PR head, so the final documentation head must also receive a fresh exact-SHA green gate before #517 is considered ready for repository-owner/manual RC confirmation. Do not merge #517 or create RC3 automatically.

## Stable `main` line

- `main` remains on Harness Remote 3.0.2 and has not been modified by the 3.1 work.
- Stable-line PR #512 contains the OpenCode rail-state fix adapted to the 3.0 shell.
- #512 is fully green but remains **open and unmerged**. Do not merge it into `main` without explicit authorization.
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
- the OpenCode permission/question settle fallback may add one bounded trailing read, but ACP keeps its existing immediate-only resolution path.

## CI / packaging

The release-candidate gate is not satisfied by unit/type-check alone. Before integration or RC freeze require, on the exact candidate SHA:

- type-check/build and web regressions;
- OpenCode permission transport regression;
- bridge tests on Windows and macOS;
- Chromium product smoke including the complete OpenCode reliability matrix and cross-machine scenarios;
- desktop tests on Ubuntu, macOS and Windows, including packaged embedded-daemon execution where applicable;
- signed Debug APK.

Android CI was previously repaired so `android-actions/setup-android@v4` no longer requests the retired SDK `tools` package; Android 36 packages are installed explicitly. There is no push-triggered workflow on the integration branch, so PR validation is the applicable gate before merge.

## External PRs

- PR #494 (`Mimocode`) was closed without merge after real validation showed its primary product behavior was not delivered when OpenCode and Mimocode coexist.
- PR #504 (`custom ACP primaries`) is not part of the 3.1.0 candidate. Re-review only with coherent end-to-end parse/start behavior and executable coverage of the actual boundary.

## Release boundary

The intended next release is **Harness Remote 3.1.0**, not 3.0.3.

The complete automated OpenCode campaign is green on runtime head `4c97c85fd1d22e2c669ac725e7a423506d7e85e6`. Do not freeze RC3 until the final documentation head has the same complete green gate and repository-owner/manual real OpenCode validation confirms the reported RC2 failures are gone. After that, remaining release evidence is true-boundary validation:

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
