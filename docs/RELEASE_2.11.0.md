# Harness Remote 2.11.0

Harness Remote 2.11.0 is a major step forward for the 2.x line and the stable foundation for the next generation of the project.

## Highlights

- Run one Harness Remote server per machine instead of separate public servers for each supported harness.
- Auto-detect supported local agents: OpenCode, Codex CLI, Claude Code, Oh My Pi, and PI.
- Route sessions and model discovery through the selected agent behind the same machine endpoint.
- Manage OpenCode internally without exposing its loopback host or port as user configuration.
- Use agent-scoped model discovery through the unified machine endpoint.
- Use the same server profiles from Desktop and Android clients; browser clients can connect with explicit CORS origins.
- Improve server/profile setup, session routing, model loading, completion handling, Android behavior, Desktop behavior, and cross-platform stability.
- Surface useful ACP provider error messages instead of losing actionable details behind generic internal errors.
- Improve PI compatibility, including native session titles and rename metadata, journal-backed history, provider-error and retry recovery, and more robust Windows behavior.
- Improve session replay and history merging performance.
- Preserve and migrate legacy server profiles more safely while isolating session state between machines and harnesses.

## Unified multi-agent architecture

The biggest architectural change in 2.11.0 is that Harness Remote is no longer centered around one manually configured harness endpoint at a time.

A machine daemon can discover the supported coding agents installed on the host and expose them behind one public Harness Remote endpoint. The client then selects the harness and model it wants to use.

This simplifies remote setup, removes redundant per-harness public servers, and provides a much cleaner base for future orchestration features.

The preferred launcher is:

```bash
npx github:giuliastro/harness-remote \
  --host 0.0.0.0 --port 4097 \
  --username harness --password "use-a-long-unique-password" \
  --root "$HOME/Software"
```

Supported CLIs are discovered automatically from `PATH`. The public daemon port is normally `4097`. Managed OpenCode uses an internal loopback server and its internal port should not be configured directly in the client.

## Client applications

Harness Remote 2.11.0 supports the current client surfaces:

- Desktop application for Windows, macOS, and Linux
- Android APK
- Local Web/PWA
- GitHub Pages hosted client

Browser clients require their exact origin to be allowed with `--cors`. Native Desktop and Android clients do not require browser CORS configuration.

## Session and reliability improvements

2.11.0 includes a large set of fixes accumulated while stabilizing the multi-agent architecture, including improvements to:

- first-run server setup
- saved server profiles and migration
- machine and harness routing
- model catalog loading and retry behavior
- Android/native response handling
- completion timing and audio
- session opening and refresh behavior
- cross-server session isolation
- ACP session loading and replay
- provider error reporting
- PI history consistency after failed or retried provider calls
- Windows and macOS bridge behavior

The goal of these changes is to keep the existing remote-session workflow reliable while the underlying architecture becomes substantially more capable.

## Preparing the path to Harness Remote 3.0: TaskDesk

This release also prepares the architectural path for the future 3.0 generation, which will be called **TaskDesk**.

TaskDesk will evolve the project from a remote harness/session controller into a more general task manager for AI coding agents and harnesses.

The direction already being prepared includes:

- a machine-centric home and configuration model
- projects as first-class entities
- explicit `Task -> Run -> Session` relationships
- task lifecycle states such as queued, running, completed, failed, and cancelled
- per-task agent/harness and model selection
- isolated Git worktrees for tasks when appropriate
- project-directory execution for non-Git workloads
- task result and workspace-change inspection
- finish, review, cleanup, reopen, and failure-recovery flows
- richer session trees for subagents and forks
- a clear distinction between a user task and the underlying agent sessions used to execute it

The TaskDesk work is **not** presented as a completed 2.11.0 feature. Harness Remote 2.11.0 is the stable 2.x foundation that makes that transition possible without sacrificing the current remote-session workflow.

## Validation

Before promotion to `main`, the 2.11.0 release candidate was validated with:

- web type-check and production build
- web regression tests
- bridge test suite
- Windows bridge tests
- macOS bridge tests
- Android debug APK build
- Android APK signature verification
- runtime validation of the release candidate

Harness Remote 2.11.0 preserves the current product while establishing the stable technical base for TaskDesk 3.0.
