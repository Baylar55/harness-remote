# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after all applicable CI is green on the exact head and the repository owner explicitly authorizes the merge after any required real validation.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over source-text assertions when a behavior can be exercised directly.
- Do not ask the repository owner for manual validation until code/diff review and all applicable automated gates are green.

## Current integration baseline

- Integration head: `aa474fead5d6d1ab5afc3f0e2912bdfdf3005d94`.
- PR #517 (`fix(opencode): stabilize retry, error and remount lifecycle`) is merged into integration after real Zorin/OpenCode validation.
- PR #520 (`fix: recover browser machine state after idle`) is merged into integration after exact-head automated validation and accepted real idle/wake validation.
- The earlier `9a09b50afb504834df8743418f5ce99ff12e896f` OpenCode candidate remains failed real-validation evidence: it could show reasoning-only false `Ready` and wedge a second Send. Do not use its old green synthetic CI as release evidence.
- `web/package.json` is `3.1.0`.
- `main` remains on Harness Remote 3.0.2 at `21ce6db49af708c4c7c3f96ef6a50f62dced8dab`; the 3.1 development line has not been merged to `main`.

The integration line is still in **3.1.0 release-candidate stabilization**. Avoid unrelated feature work until the release boundary is cleared.

## Active work — PR #519 startup-output cleanup

- branch: `codex/startup-output-cleanup`;
- PR: **#519** `ux: simplify startup output`;
- target: `codex/development-2026-09-11` only;
- branch was resynchronized with integration after #520 merged;
- final feature head after the user-requested UX simplification: `57f1c53883c848aa9a69292fadc931ff3fd9ed36`;
- PR remains **draft** until the final exact-head automated campaign is green;
- this work is terminal/onboarding UX only and must not change ACP routing, Native Session behavior, OpenCode lifecycle, model routing, pairing authorization, credentials or the one-time token protocol.

Final user-approved output contract:

- one launcher-owned **Connection** block;
- one preferred reachable machine address displayed as `IP:port`, deliberately without `http://` so the backend endpoint is not presented as a clickable web page;
- username/password exactly once;
- no `Open in browser` line: the launcher cannot guarantee that Vite or any other separate web frontend is running;
- one **Harnesses** list containing only harness names, with no `primary`, `starts on first use`, `available`, transport or lifecycle qualifiers;
- one optional phone-pairing QR;
- no raw `harnessremote://...` URI, token, alternate interface URL or duplicate endpoint under the QR;
- if QR rendering is unavailable, fall back to the already printed machine address and credentials;
- launcher-owned daemon/bridge children emit only the final ready line instead of repeating endpoint, machine ID and harness list;
- direct advanced invocation of `harness-remote-daemon` / the standalone bridge keeps its diagnostic startup output.

Behavioral coverage locks the non-clickable address, absence of browser URLs, plain harness list, preferred-address selection, pairing-output redaction and launcher/child output ownership.

After the final #519 exact-head campaign is green, the repository owner has already instructed to proceed with integration and a new 3.1.0 release candidate. Do not mutate the frozen RC3 branch; create a new RC from the updated integration branch.

## OpenCode reliability guardrails

Read `docs/OPENCODE_RELIABILITY_CONTRACT.md` before changing OpenCode Session projection, lifecycle routing or reconciliation. Do not regress behavior established by #304/#306/#337/#351/#355/#391/#421/#422/#425/#451/#452/#453/#513/#517.

In particular:

- ordinary internal idle/pre-Send OpenCode must not depend on continuous `/session/status` polling;
- persisted replies must remain recoverable when event delivery or status lookup is unavailable;
- permission and mounted-Session convergence must not create false red interruptions;
- unresolved requests remain Attention rather than being silently treated as completed;
- routed OpenCode lifecycle must not leak into ACP backends or sibling agent identities;
- `finish: "stop"` on a reasoning-only assistant envelope is not successful turn completion;
- a turn stays pending until durable terminal assistant text/error or bounded no-final recovery settles it;
- a stable native idle edge after Send is enrichment, not durable-final proof;
- OpenCode permission/question settlement may use its bounded trailing reconcile, while ACP keeps its established semantics.

## CI / packaging gate

Before integration or RC freeze require, on the **exact candidate SHA**:

- type-check/build and web regressions;
- OpenCode permission transport regression;
- bridge tests on Windows and macOS;
- Chromium product smoke including the complete OpenCode reliability matrix and cross-machine scenarios;
- real OpenCode + Zen existing-Session gate when the workflow applies;
- desktop runtime/menu tests on Ubuntu, macOS and Windows, including packaged embedded-daemon execution where applicable;
- signed Debug APK when the PR workflow reaches that stage.

Do not weaken a product assertion to make a flaky run green. Re-run the same SHA first when failure evidence points to timing rather than a reproducible regression.

## Release boundary

The intended next release is **Harness Remote 3.1.0**. The frozen branch `codex/release-candidate-3.1.0-rc3` remains immutable historical candidate evidence. After #519 integrates, create a new release-candidate branch from the then-current integration head rather than modifying RC3.

Remaining release-readiness work still includes applicable true-boundary evidence tracked by issue #368, including real harness/runtime restart and persisted-Session recovery, physical Android foreground/background plus network interruption/reconnect, and repository-admin enforcement on `main` where the connected GitHub App lacks permission to make that administration write.

## Roadmap boundaries

- P0 issue #368 owns true-boundary release evidence and repository-admin enforcement.
- P1 issue #369 covers onboarding/reliability work already largely integrated; avoid rebuilding implemented pairing, Attention, desktop runtime and recovery flows.
- P2 issue #371 owns longer-term federation/cross-machine continuity; do not redo already integrated lineage, portable handoff, Project identity/outcome and cross-machine execution work.

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.
