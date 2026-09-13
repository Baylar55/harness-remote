# Development status

> This file is the handoff point for ongoing development work that is not yet on `main`.
> Keep it short, current and safe to read at the start of a new coding-agent session.

## Branch policy

- Persistent integration branch: `codex/development-2026-09-11`.
- Never merge development work directly into `main`.
- Feature/fix PRs target `codex/development-2026-09-11` only.
- Merge into the integration branch only after relevant tests and CI are green.
- ACP, Native Session and harness-runtime changes require regression review against previously fixed failures before merge.

## Current integration baseline

- Integration head after PR #487: `525c64a7f30be551dd4d5ce060be27e3e5c2d0f8`.
- PR #468 added bounded recovery of the embedded desktop daemon and was validated on Zorin with a real `SIGSTOP` recovery test.
- PR #469 added bounded Git aggregate outcome evidence: tracked files, insertions, deletions and binary files, with no raw diff/hunks/source sent to the client.
- PR #470 fixed the Machines UX race: connection fields now appear only after an explicit **Add machine** action, including when Electron discovers its managed local machine asynchronously.
- PR #471 made cross-machine continuation planning/safety a blocking Chromium regression.
- PR #472 extended that blocking smoke through real execution: exact-workspace recovery after a blocked Project choice, exactly-once target Native Session creation, source+target lineage persistence, authority reset, exactly-once first prompt and opening the target Session after live model-catalog bootstrap.
- PR #474 replaced Machine discovery source-text assertions with an executable contract against the real `discoverMachine()` path.
- PR #475 replaced the attachment forwarding source-text assertion with an executable `api.sendPrompt()` transport contract covering directory, model, variant, agent and attachment payloads.
- PR #476 replaced model-picker source-text ordering guards with an executable `groupModels()` contract that treats variant labels as opaque and preserves the harness-advertised order.
- PR #477 replaced the remaining `api.listModels()` source-text guards with an executable transport/catalog contract covering directory + Session scope, harness defaults, capabilities/limits and exact harness variant order.
- PR #478 replaced the stale-model source guard around new Native Session creation with a real `createNativeSessionTarget()` contract covering selected-harness scope, Project/title forwarding, writer ownership, surfaced capabilities and fail-closed identity.
- PR #479 replaced Native Session model-recovery source guards with an executable `resolveNativeSessionTargetModel()` contract while reusing existing lifecycle coverage instead of duplicating it.
- PR #480 retired the remaining redundant model-reconciliation source guards and stabilized the cross-machine Chromium smoke by waiting for the settled Project/model catalog state already supported by production. No runtime behavior changed; the complete Chromium, desktop and signed Debug APK gates passed before integration.
- PR #481 added explicit per-harness `--inference-unavailable` evidence and made desktop Linux/macOS/Windows coverage automatic for every PR targeting `main` or the persistent integration branch.
- PR #482 added explicit known-working model selectors for real-harness validation, with fail-closed missing/ambiguous model resolution and selected-model-scoped variant coverage. Full Chromium, desktop and signed Debug APK gates passed before integration.
- PR #483 retired redundant `native-session-model.ts` source guards from the observer/controller regression after #479 supplied executable coverage. Its CI-contract wiring was corrected before merge and the full Chromium, desktop and signed Debug APK gates passed.
- PR #484 strengthened the executable native-create capability contract with fail-closed coverage for unsupported transports plus explicit `sessions=false` and `prompt=false`; it adds no runtime behavior and passed the full Chromium, desktop and signed Debug APK gates.
- PR #485 retired two redundant model-bootstrap source guards from `model-regression.test.mjs` in favor of the blocking Chromium model-switch smoke, which holds `/models` unresolved and proves the composer and Send stay gated until a verified catalog arrives. Full Chromium, desktop and signed Debug APK gates passed before integration.
- PR #486 retired the remaining duplicate model-bootstrap source guards from the observer/component regressions while preserving distinct reconnect and catalog-failure contracts. The full Chromium behavior smoke, desktop matrix and signed Debug APK gates passed before integration.
- PR #487 retired four redundant native-create source guards while preserving the architectural no-Task/no-Conversation boundary. Its first two Chromium attempts exposed one remaining premature Project-value read during legitimate same-target route revalidation; the smoke was aligned with #480 by waiting for settled Project/model state, then the complete Chromium, desktop and signed Debug APK gates passed.
- #474-#480 and #483-#487 are behavior-preserving contract/CI-hardening slices under issue #330; #481-#482 are release-evidence hardening under #368. Production ACP/harness behavior was not changed by these slices.

## Current roadmap boundary

Active WIP branch: `codex/discovery-behavior-contract`.

The current #330 slice moves Native Session discovery guarantees from source-text inspection into the existing executable discovery contract. `native-session-discovery.test.mjs` already proves global-list fallback, paging, status behavior, `sessions=false`, multi-agent discovery and surface mapping; this slice adds positive `sessionRename/sessionDelete` capability propagation through discovery and the surface target, then retires the now-redundant source guards for global→stable fallback and rename/delete capability mapping. Native identity type guards plus the architectural no-Task/no-launch guards remain. No production code is changed.

### P0 — issue #368

Repository/fixture-side automation is effectively exhausted. Do not add synthetic coverage for the remaining true boundaries. #368 stays open for:

- strict `gate:real-harness` execution against actually installed, concretely versioned OpenCode/Codex/Claude/OMP/PI builds on a traceable machine, using known-working models where available and explicitly recording unavailable inference without weakening fail-closed release evidence;
- real daemon/adapter restart plus persisted-Session resume/claim evidence against those installed harnesses;
- physical Android foreground/background/network-interruption checks;
- repository-admin enforcement of `main` pull-request/required-check rules.

### P1 — issue #369

Repo-side pairing, Attention semantics, desktop-owned local runtime, packaged-runtime execution, PATH recovery, health/reconnect recovery and Machines simplification are implemented. #468/#470 add the latest recovery/UX evidence.

Do not invent more P1 UI/runtime surface merely because #369 remains open. It is intentionally left open while its declared P0 prerequisite still has real-environment/admin evidence outstanding.

### P2 — issue #371

Do not restart federation or cross-machine continuity work already integrated:

- #411-#413: federated Native Session read model, operational buckets and machine/Project/harness/model/state scopes;
- later P2 slices: durable Project/native identity, lineage, portable handoff state and crash/retry-safe target creation/first prompt;
- #435/#436: recovered portable state plus source-authority invalidation / target fail-closed authorization acceptance;
- #437-#439/#469: bounded Project/outcome evidence, structured completion/attention/next action and Git aggregates;
- #471/#472: blocking Chromium planning and full execution coverage.

One deliberate non-claim remains: do not infer `checks run/failed` from transcript/tool prose. There is no provider-neutral structured source yet, so absence is safer than heuristic evidence.

#371 remains open while its declared #368/#369 prerequisites are open at true-boundary evidence, not because another federation implementation is missing.

## Product direction

Continue from `docs/HARNESS_3_ROADMAP.md`, prioritizing correctness/recovery, onboarding, attention visibility and Native Session federation. Avoid turning Harness Remote into a generic IDE/task manager or reimplementing capabilities that belong to native harnesses.

Do not begin P3 provider-extension work merely to keep development moving while P0/P1/P2 true-boundary gates are unresolved. Prefer real validation or a clearly evidenced defect over speculative new surface area.
