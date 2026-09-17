# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after the exact-head automated campaign is completely green and the repository owner explicitly authorizes the merge after real validation when applicable.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over source-text guards.
- Do not ask the repository owner to manually validate a candidate until all applicable automated gates are green.

## Current integration baseline

- Integration head: `f72f3e5a54678022654f3317a38839a30a1ba575`.
- PR #517 (`fix(opencode): stabilize retry, error and remount lifecycle`) is merged into the integration branch after the repository owner confirmed the real Zorin/OpenCode flow works.
- The previously failing real behavior on `9a09b50` — reasoning-only false `Ready` and a stalled second Send — is fixed by the merged #517 line.
- `web/package.json` remains `3.1.0`.
- `main` remains the stable 3.0.2 line at `21ce6db49af708c4c7c3f96ef6a50f62dced8dab`. Do not modify it.

## RC3

- Frozen candidate branch: `codex/release-candidate-3.1.0-rc3`.
- RC3 was frozen from the post-#517 integration head. Keep that branch immutable as candidate evidence.
- No final 3.1.0 tag/release has been published from RC3.
- Remaining final-release evidence still includes the true-boundary multi-provider/restart/physical-device checks described below.

## Startup-output cleanup — PR #519

- branch: `codex/startup-output-cleanup`;
- PR: #519, draft;
- target: `codex/development-2026-09-11` only;
- exact feature head: `ffa09a46d4aed394629f2896a7fb4783b7576157`.

Purpose: make the launcher output usable by humans without changing runtime semantics.

- one preferred reachable Machine URL;
- one optional browser URL only when backed by the configured CORS origin;
- no normal-user `0.0.0.0` URL;
- no raw `harnessremote://` deep-link dump under the QR;
- one harness list, one QR, one Ready message;
- launcher-owned daemon/bridge children suppress duplicate endpoint/machine/agent output, while direct daemon/bridge invocation keeps diagnostics.

Automated evidence on `ffa09a46`:

- desktop runtime/application-menu workflow: green on Ubuntu/macOS/Windows;
- OpenCode live Zen gate: green;
- type-check/build, full web regressions, permission transport and bridge tests: green;
- Chromium product smoke initially hit a 2.5s `No available channel` timing timeout in the pre-existing OpenCode retry/error smoke, then passed completely on an unchanged same-SHA rerun, including Native Session, cross-machine continuation and complete-controls coverage;
- Debug APK: green.

Do not merge #519 solely because the rerun is green; keep normal integration/owner-confirmation discipline.

## Active idle/resume recovery — PR #520

Real browser testing exposed another release blocker after several minutes of inactivity/display-off while the computer itself remained awake:

- the UI could return stuck on `Loading sessions…` with every saved machine shown offline;
- reloading could leave a white page while the Vite development `index.html` itself was still returned;
- there were no daemon crash/log messages.

Active branch: `codex/idle-resume-recovery`, forked exactly from integration `f72f3e5a54678022654f3317a38839a30a1ba575`.
PR #520 targets only `codex/development-2026-09-11` and must remain draft until exact-head automated green plus real idle/wake validation.

Evidence-backed browser failure mechanisms:

- workspace visibility recovery already starts fresh machine discovery when the document becomes visible;
- browser machine-discovery requests from before the idle period were not actually cancelled — old generations were only ignored after completion;
- browser/OS suspension can freeze fetch/socket progress and timeout timers while wall-clock time continues;
- on wake, stale pre-idle requests could therefore overlap the new discovery cycle and reconnect work, producing a machine-offline/loading storm even though the daemon process had not been shown to exit;
- authenticated browser SSE relied primarily on its normal stall watchdog, so a socket frozen during suspension could remain stale after foregrounding until the watchdog ran again;
- ordinary native-Session/OpenCode browser API reads (`api.ts`) had no AbortController/read timeout at all, unlike the equivalent Capacitor-native path. A pre-idle Session/history/status request could therefore remain pending indefinitely and keep `Loading sessions…` alive after wake.

Current fix on this branch:

- browser `/v1/machine` discovery is single-flight per machine/credential identity;
- overlapping ordinary refreshes share one transport instead of stacking duplicate HTTP requests;
- a wake-triggered discovery that finds an in-flight request older than the normal 12s discovery window aborts that stale transport and replaces it with exactly one fresh request;
- desktop IPC and Capacitor-native discovery paths are unchanged;
- authenticated browser SSE reconnects immediately after a **real** browser resume: hidden → visible, persisted BFCache `pageshow`, or explicit `online`; the initial non-persisted `pageshow` is ignored so startup does not create a duplicate stream/reconciliation cycle;
- reconnect backoff is reset on explicit lifecycle recovery and the old controller cannot schedule a duplicate reconnect;
- closing a subscription detaches the lifecycle listeners;
- ordinary browser `api.ts` requests now have a bounded 30s read window matching the existing Capacitor-native default and abort the underlying fetch when it expires;
- operations that already declare a 300s `readTimeout` retain that longer window;
- Android native event transport and the unauthenticated EventSource prototype remain unchanged.

Behavioral coverage added:

- `web/src/machine-client-discovery.test.mjs`: simultaneous discovery coalesces to one fetch; a simulated pre-sleep request older than the discovery window is aborted and replaced by exactly one successful wake request;
- `web/src/opencode-events.test.mjs`: initial `pageshow` does not reconnect; hidden state does not reconnect; hidden → visible, persisted BFCache and online recovery do reconnect; closed subscriptions ignore later lifecycle events;
- `web/src/api-list-models.test.mjs`: an indefinitely pending browser Session read is aborted by the 30s browser API boundary (accelerated by the test), and the timeout matches the existing native default.

These tests are already part of `test:ci:full` through `test:machine-payload`, `test:events`, and `test:model`.

Exact-head campaign history worth preserving:

- `c99eeb0765d139c75613f7ed6aaa45a7e70613b5`: type-check/full regressions, bridge tests, desktop all platforms and real OpenCode + Zen were green, but Chromium caught a deterministic startup regression: first-load `pageshow` opened a second SSE and caused an extra pre-Send `/session/status` request (`3 !== 2`) in `native-opencode-real-regression-smoke.mjs`;
- this was fixed by requiring a real resume boundary rather than treating initial `pageshow` as wake; rerun the complete campaign on the new exact head before any manual validation.

Do **not** add a speculative daemon self-restart/watchdog without evidence that the daemon process exits. The current report proves browser/network recovery failure modes, not an idle-shutdown policy in the daemon.

A separate ACP bridge SSE lifetime inconsistency was noticed during review: the primary bridge stream still keys cleanup from `IncomingMessage.close`, while `ManagedEventFanout` correctly owns downstream lifetime through request abort/response close. Do not fold that into this idle fix without a focused executable reproduction; changing ACP streaming speculatively would violate the release-stabilization boundary.

Next steps for #520:

1. run the complete exact-head automated campaign on the final branch head;
2. fix any deterministic regression on the same branch and rerun the complete campaign;
3. only after all automated gates are green, ask for a real idle/display-off → wake validation without reloading;
4. verify a normal page reload still renders and reconnects after the idle cycle;
5. merge only after that real validation succeeds and the owner explicitly confirms it.

## OpenCode reliability guardrails

Read `docs/OPENCODE_RELIABILITY_CONTRACT.md` before changing OpenCode Session projection, lifecycle routing or reconciliation. Do not regress #304/#306/#337/#351/#355/#391/#421/#422/#425/#451/#452/#453/#513/#517.

In particular:

- ordinary internal idle/pre-Send OpenCode must not depend on continuous `/session/status` polling;
- persisted replies must remain recoverable even when event delivery/status lookup is unavailable;
- unresolved requests remain Attention rather than being silently treated as completed;
- routed OpenCode lifecycle must not leak into ACP backends or sibling agent identities;
- `finish: "stop"` on a reasoning-only assistant envelope is not successful turn completion;
- a stable native idle edge after Send is enrichment, not durable-final proof;
- ACP retains its established permission/transcript semantics.

## CI / packaging gate

Before integration or release-candidate promotion require, on the exact candidate SHA:

- type-check/build and full web regressions;
- OpenCode permission transport regression;
- bridge tests on Windows and macOS;
- Chromium product smoke including the complete OpenCode reliability matrix and cross-machine scenarios;
- real OpenCode + Zen existing-Session gate;
- desktop tests on Ubuntu, macOS and Windows, including packaged embedded-daemon execution where applicable;
- signed Debug APK.

There is no push-triggered workflow on the integration branch, so PR validation is the applicable pre-merge gate.

## Remaining 3.1.0 true-boundary evidence

Before the final 3.1.0 release, still require where available:

- strict real-harness checks against installed OpenCode/Codex/Claude/OMP/PI builds, recording unavailable harness/model combinations instead of substituting synthetic ones;
- real daemon/adapter restart plus persisted-Session resume/claim;
- physical Android foreground/background and real network interruption/reconnect;
- repository-admin enforcement on `main` requiring pull requests and required checks. The connected GitHub App cannot perform that administration write.

## Product direction

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.
