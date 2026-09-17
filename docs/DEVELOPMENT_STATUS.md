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

- Integration head before PR #519 synchronization: `aa474fead5d6d1ab5afc3f0e2912bdfdf3005d94`.
- PR #517 (`fix(opencode): stabilize retry, error and remount lifecycle`) is merged into integration after real Zorin/OpenCode validation.
- PR #520 (`fix: recover browser machine state after idle`) is merged into integration after exact-head CI and owner-approved real browser validation on `9a5497489d28df78f01312eafea2b056c9d5849e`.
- `web/package.json` remains `3.1.0`.
- `main` remains the stable 3.0.2 line at `21ce6db49af708c4c7c3f96ef6a50f62dced8dab`. Do not modify it.

## RC3

- Frozen candidate branch: `codex/release-candidate-3.1.0-rc3`.
- RC3 predates the latest integration fixes and stays immutable as historical candidate evidence.
- Do not amend RC3. If the current integration line becomes release-ready, create a new RC from the updated integration branch.
- No final 3.1.0 tag/release has been published from RC3.

## Active work — PR #519 startup-output cleanup

- branch: `codex/startup-output-cleanup`;
- PR: #519 `ux: simplify startup output and browser links`;
- target: `codex/development-2026-09-11` only;
- synchronized with integration baseline `aa474fead5d6d1ab5afc3f0e2912bdfdf3005d94` after #520 merged;
- keep draft until the complete automated campaign is green on the new exact head and the real startup output is validated.

Purpose: make launcher output usable by humans without changing runtime semantics.

Intended output contract:

- one launcher-owned Connection block;
- one preferred reachable Machine URL, never every interface and never `0.0.0.0` as a client instruction;
- username/password exactly once;
- `Open in browser` only when a real browser origin is configured through CORS;
- hosted `https://giuliastro.github.io` maps to `https://giuliastro.github.io/harness-remote/` while preserving the configured CORS origin;
- one Harnesses list, primary harness first, without repetitive `available` wording;
- one optional phone-pairing QR;
- no raw `harnessremote://` URI, pairing token or alternate interface URLs below the QR;
- if QR rendering is unavailable, point back to the already printed manual Machine URL and credentials;
- launcher-owned daemon/bridge children suppress duplicate endpoint, machine ID and harness-list output;
- direct advanced daemon/bridge invocation keeps diagnostic startup output.

Behavioral coverage locks the concise pairing contract, preferred-address selection, browser URL/CORS relationship, primary-first harness ordering and child-process output ownership.

The earlier #519 exact head `ffa09a46d4aed394629f2896a7fb4783b7576157` passed desktop Ubuntu/macOS/Windows, OpenCode live Zen, type-check/full regressions, permission/bridge tests, Chromium on unchanged-SHA rerun and Debug APK. That evidence predates #520 integration and is not sufficient for merge. Run the entire campaign again on the synchronized exact head.

## Idle/resume recovery — merged PR #520

The merged fix addresses browser-side recovery after display-off/inactivity while the computer itself stays awake:

- browser `/v1/machine` discovery is single-flight per machine/credential identity;
- stale pre-idle discovery older than the 12s window is aborted and replaced by one fresh request;
- authenticated browser SSE reconnects only after a real recovery boundary: hidden → visible, persisted BFCache `pageshow`, or `online`;
- initial non-persisted `pageshow` is intentionally ignored so startup does not duplicate OpenCode reconciliation;
- ordinary browser API reads have a 30s AbortController-backed boundary matching the existing Capacitor-native default;
- explicit 300s operations keep their longer timeout;
- desktop IPC, Capacitor-native discovery, Android native event transport and ACP semantics are unchanged.

The first implementation incorrectly treated initial `pageshow` as resume; Chromium caught the resulting extra pre-Send OpenCode `/session/status` request. The corrected exact head passed the full automated campaign before merge.

A later observation remains unproven and should not be changed speculatively: an already-open Vite development tab can sometimes remain white across backend/web-server restarts while the same URL works immediately in a new tab. In development the app unregisters its own service workers and clears Harness Remote caches, so capture Console + Network in the affected old tab before changing code if this reproduces again.

Do not add a speculative daemon self-restart/watchdog without evidence that the daemon process exits.

A separate primary ACP bridge SSE lifetime inconsistency was noticed during review. Do not fold it into unrelated stabilization work without a focused executable reproduction.

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
- Debug APK.

There is no push-triggered workflow on the integration branch, so PR validation is the applicable pre-merge gate.

## Remaining 3.1.0 release boundary

After #519 is integrated, reevaluate the full integration line rather than mutating frozen RC3. Before final 3.1.0 release still require where available:

- strict real-harness checks against installed OpenCode/Codex/Claude/OMP/PI builds, recording unavailable combinations instead of substituting synthetic ones;
- real daemon/adapter restart plus persisted-Session resume/claim;
- physical Android foreground/background and real network interruption/reconnect;
- repository-admin enforcement on `main` requiring pull requests and required checks. The connected GitHub App cannot perform that administration write.

## Product direction

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.
