# OpenCode Session rail lifecycle fix

Temporary handoff note for the 3.1 integration port.

- Stable-line PR: #512 (`codex/fix-opencode-session-rail-live-state` -> `main`).
- Integration port branch: `codex/port-opencode-session-rail-live-state` -> `codex/development-2026-09-11`.
- Reproduced defect: Session A remains `Working` in the Session rail after the user opens Session B, even though A completed; reopening A hides the defect by forcing reconciliation.
- Fix: lifecycle events invalidate the Session index even when `/v1/machine` is structurally unchanged; a bounded streamed `session.status`/`session.idle` observation can temporarily beat a lagging native status read.
- Safety: no prompt/Send routing changes, no Stop changes, no ACP writer changes, no polling-cadence changes, and the OpenCode #351 pre-Send no-status-wait behavior remains under the existing browser regression suite.
- New blocking browser smoke: `web/scripts/native-opencode-rail-state-smoke.mjs` reproduces A Working -> navigate to B -> A Ready without reopening A.
- CI maintenance discovered while validating #512: `android-actions/setup-android@v4` currently defaults to the retired Android SDK `tools` package. The workflow now uses `packages: ''` and installs the exact platform/build-tools in the following step.

Do not merge either line until its complete CI is green. Update `docs/DEVELOPMENT_STATUS.md` when the integration PR is accepted or rejected, then remove this temporary note.
