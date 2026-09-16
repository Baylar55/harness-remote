# Development status

> Handoff point for ongoing work that is not yet on `main`. Keep this current, concise and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Internal feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into integration only after the relevant CI is completely green.
- ACP, Native Session, routing, models and harness-runtime changes require regression review against previously fixed failures.
- Prefer executable behavioral coverage over new source-text guards.

## Current integration baseline

- Integration head after PR #513: `0dadac745aa346caf4e9c57e2c1ed857e238303a`.
- PR #511 marked the Harness Remote 3.1.0 release-readiness boundary.
- PR #513 integrated the OpenCode Session-rail lifecycle fix discovered during real testing: a Session that completed while another Session was selected could remain visually `Working` until reopened.
- #513 uses lifecycle-driven Session-index invalidation, a bounded 15s streamed-status grace and a blocking Chromium product smoke. It does **not** change prompt/Send routing, Stop, ACP writer ownership, transcript settlement, polling cadence or the #351 pre-Send invariant.
- #513 was validated before merge with regressions/type-check, OpenCode permission transport, bridge macOS/Windows, Chromium including the new rail-state scenario and cross-machine coverage, desktop Ubuntu/macOS/Windows, signed Debug APK and artifact upload.
- There is no push-triggered workflow on the integration branch; after merge the branch head was verified directly at the merge commit above.

No feature branch is currently the active integration WIP. The branch is in **3.1.0 release-candidate stabilization**.

## Stable `main` line

- `main` remains at the 3.0.2 line and was not modified by #513.
- Stable-line PR #512 contains the corresponding OpenCode rail fix adapted to the 3.0 shell. Its final head is `9ce62fd0af26baf20cb927af9202f7574eb67f31`.
- #512 is fully green: type-check/regressions, bridge macOS/Windows, Chromium reproducing `A Working → open B → A Ready without reopening A`, desktop menu coverage, Debug APK build/signature and artifact upload.
- #512 remains **open and unmerged**. Do not merge it into `main` without explicit authorization.
- The earlier client-only `MachineSnapshot` epoch design was removed. The stable implementation keeps `/v1/machine`, `MachineSnapshot`, config and daemon payload contracts clean and invalidates exactly the next structural workspace reconciliation instead.

## OpenCode reliability guardrails

Do not regress the behavior established by #304/#306/#337/#351/#355/#391/#421/#422/#425/#451/#452/#453.

In particular:

- ordinary internal idle/pre-Send OpenCode must not depend on `/session/status` (#351);
- persisted replies must remain recoverable even when event delivery or status lookup is unavailable (#421/#422/#425);
- permission and mounted-Session convergence must not create false red interruptions (#452);
- unresolved requests remain Attention rather than being silently treated as completed (#451);
- PR #501 extracted deterministic OpenCode assistant-envelope classification without changing the stateful #351 lifecycle.

The remaining source-guard families around current-turn OpenCode matching, model fallback, writer acquisition, projection disposal, silent recovery, pending-prompt reconciliation and reply settle still protect distinct behavior. Do not delete them merely to reduce guard count; first provide equivalent executable coverage.

## CI / packaging note

Validation of #512/#513 exposed a repository CI failure unrelated to product behavior: `android-actions/setup-android@v4` still defaulted to the retired Android SDK `tools` package. The workflow now skips that default package set (`packages: ''`) and explicitly installs Android 36 platform/build-tools. Both #512 and #513 subsequently built, signed and uploaded the Debug APK successfully.

## External PRs

- PR #494 (`Mimocode`) was closed without merge. Real validation showed that with OpenCode + Mimocode installed, both CLIs could be detected while only OpenCode was exposed as the managed backend; its external-session behavior was also narrower than advertised. Do not revive or port #494 into 3.1.
- PR #504 (`custom ACP primaries`) is not part of the 3.1.0 candidate. Its helper-level plan must not bypass the real `parseConfig()` / `harnessProfile()` startup boundary. Re-review only with coherent end-to-end behavior and executable coverage of the actual parse/start path.

Do not publish comments/reviews on external contributor PRs unless explicitly requested by the repository owner.

## Release boundary

The intended next release is **Harness Remote 3.1.0**, not 3.0.3. Compared with 3.0.2, integration already contains substantial P1/P2 work: pairing/onboarding, Attention semantics, desktop-owned local runtime/recovery, Project/outcome evidence and cross-machine Native Session continuity.

Repository/fixture-side release coverage is essentially exhausted. Release publication remains blocked by true-boundary evidence and repository administration:

- strict `gate:real-harness` against the actually installed OpenCode/Codex/Claude/OMP/PI builds, using known-working models where available and explicitly recording unavailable inference;
- real daemon/adapter restart plus persisted-Session resume/claim on the candidate build;
- physical Android foreground/background plus real network interruption/reconnect validation;
- `main` ruleset/branch protection requiring pull requests and always-present release checks. The connected GitHub App cannot perform this administration write.

Freeze the 3.1.0 release candidate from the current integration line only after deciding the remaining true-boundary evidence plan. Do not start opportunistic P3 provider expansion or source-guard cleanup before the release.

## Roadmap boundaries

### P0 — issue #368

Keep open for the true-boundary release evidence and repository-admin enforcement above. Do not add synthetic tests as substitutes for those checks.

### P1 — issue #369

Repo-side pairing, Attention semantics, desktop-owned local runtime, packaged-runtime execution, PATH recovery, health/reconnect recovery and Machines simplification are implemented. Do not invent additional P1 UI/runtime surface merely because the issue remains open; its remaining dependency is P0 real-boundary evidence.

### P2 — issue #371

Do not redo already-integrated federation/cross-machine continuity:

- #411-#413: federated Native Session read model and operational scopes;
- durable Project/native identity, lineage, portable handoff and crash/retry-safe target creation/first prompt;
- #435/#436: recovered portable state and source-authority invalidation;
- #437-#439/#469: bounded Project/outcome evidence and Git aggregates;
- #471/#472: blocking Chromium planning and full cross-machine execution coverage.

One deliberate non-claim remains: do not infer `checks run/failed` from transcript/tool prose. There is no provider-neutral structured source yet, so absence is safer than heuristic evidence.

## Product direction

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.