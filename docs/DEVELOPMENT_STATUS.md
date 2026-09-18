# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after all applicable CI is green on the exact head and the repository owner authorizes the merge after any required real validation.
- Frozen RC branches are immutable. Any code change after an RC freeze requires a new RC.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over source-text assertions when behavior can be exercised directly.

## Current 3.1.0 integration state

The integration line is in **3.1.0 release-candidate stabilization**. Avoid unrelated feature work until the release boundary is cleared.

Validated feature baseline before this status-only update:

- PR #517 `fix(opencode): stabilize retry, error and remount lifecycle` — merged after real Zorin/OpenCode validation.
- PR #520 `fix: recover browser machine state after idle` — merged after exact-head automated validation and accepted real idle/wake validation.
- PR #519 `ux: simplify startup output` — merged; integration/RC4 baseline `1537fc41deb91759aafb8aea4bcdcb9dfb696cbd`.
- PR #521 `fix(ui): keep Native Session rail stable during activity` — merged; feature merge commit `3f63a621b2321ae12591ea6ec1fcc30873989450`.
- `web/package.json` is `3.1.0`.
- `main` remains Harness Remote 3.0.2 at `21ce6db49af708c4c7c3f96ef6a50f62dced8dab`; the 3.1 development line has not been merged to `main`.

The status-document merge may advance the integration SHA without changing product code. Resolve the current branch head before freezing the next RC.

## Frozen release candidates

- `codex/release-candidate-3.1.0-rc3` is frozen historical evidence at `f72f3e5a54678022654f3317a38839a30a1ba575`.
- `codex/release-candidate-3.1.0-rc4` is frozen at `1537fc41deb91759aafb8aea4bcdcb9dfb696cbd`.
- RC4 is **not releasable**: real-machine validation exposed the cross-harness Session-rail instability fixed by PR #521.
- Do not modify RC3 or RC4. The next candidate is **RC5**, created from the then-current integration head after this status update is integrated.

## Session rail UX contract from PR #521

The rail is shared across OpenCode, Codex, Claude, OMP and PI.

- Working/Attention/Ready/Done and native timestamp updates change presentation, not the row's visual position.
- Existing visible Sessions survive transient first-page/index omissions while the same machine+harness scope remains valid.
- New activity in an existing Project is inserted at that Project's front without moving the Project itself.
- A genuinely new Project may enter at the front.
- `Load older` appends older rows without disturbing the current layout.
- Explicit successful delete removes the Session immediately.
- Explicit user Refresh is authoritative for successful first-page reads and can prune Sessions deleted directly in a native harness.
- Automatic lifecycle refreshes remain conservative and must not interpret a transient omission as deletion.
- Status changes must not cause automatic scroll jumps.

PR #521 exact-head `ef88e4d251fa2f9387e8ddc5f751acb9bb3d041a` passed type-check/build, web regressions, bridge macOS/Windows, Chromium product smoke, real OpenCode + Zen, desktop Ubuntu/macOS/Windows and Debug APK before merge.

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
- ACP keeps its established permission/transcript semantics.

## CI / packaging gate

Before integration or RC freeze require, on the **exact candidate SHA**:

- type-check/build and web regressions;
- OpenCode permission transport regression;
- bridge tests on Windows and macOS;
- Chromium product smoke including the OpenCode reliability matrix and cross-machine scenarios;
- real OpenCode + Zen existing-Session gate when the workflow applies;
- desktop runtime/menu tests on Ubuntu, macOS and Windows;
- signed Debug APK when the PR workflow reaches that stage.

Do not weaken a product assertion to make a flaky run green. Re-run the same SHA first when evidence points to timing rather than a reproducible regression.

## RC5 real-machine release boundary

After RC5 is frozen, repeat real-machine release validation from that exact candidate.

The release gate defaults to the supported harness set `opencode,codex,claude,omp,pi` and must fail closed if a required harness is missing or a native Session operation fails.

Known RC4 validation findings:

- Claude Code was installed (`2.1.274`) but initially absent from daemon registration because the daemon had been started before the executable was visible in its environment. Restarting Harness Remote fixed registration; this was an environment/startup-state issue, not a code fix.
- A partial gate using OpenCode/Codex/OMP/PI reached PI `0.5.0` and failed Native Session creation with HTTP 400. This still needs to be re-evaluated on RC5; do not waive PI or weaken the release gate merely because it failed on RC4.
- PR #521 was discovered during this real validation and invalidates RC4 as a release candidate.

The scripted real-harness gate does **not** by itself exercise daemon/harness restart recovery or physical mobile background/foreground. Those remain separate release evidence.

## Remaining release-readiness work

Issue #368 remains open until the true boundary evidence is closed, including:

- full RC5 real-harness gate against the installed OpenCode/Codex/Claude/OMP/PI versions;
- daemon/harness restart plus persisted Native Session rediscovery/recovery;
- physical Android foreground/background and real network interruption/reconnect;
- repository-admin enforcement / branch protection on `main` (the connected GitHub App lacks administration write permission).

No final `v3.1.0` tag or release exists yet.

## Roadmap boundaries

- P0 issue #368 owns release evidence and repository-admin enforcement.
- P1 issue #369 covers onboarding/reliability work already largely integrated; avoid rebuilding implemented pairing, Attention, desktop runtime and recovery flows.
- P2 issue #371 owns longer-term federation/cross-machine continuity; do not redo already integrated lineage, portable handoff, Project identity/outcome and cross-machine execution work.

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.
