# Harness Remote 2.11.0

Harness Remote 2.11.0 focuses on a simpler multi-agent connection model and stability improvements.

## Highlights

- Run one Harness Remote server per machine instead of separate public servers for each supported harness.
- Auto-detect supported local agents: OpenCode, Codex CLI, Claude Code, Oh My Pi, and PI.
- Route sessions and model discovery through the selected agent behind the same machine endpoint.
- Manage OpenCode internally without exposing its loopback host or port as user configuration.
- Use the same server profiles from Desktop and Android clients; browser clients can connect with explicit CORS origins.
- Improve server/profile setup, session routing, model loading, completion handling, and cross-platform behavior.
- Improve PI compatibility, including native session titles and rename metadata, journal-backed history, Windows behavior, and sessions containing provider errors or retries.

The task-oriented project/run architecture under development is not part of the 2.11.0 product surface and is not presented as a completed feature in this release.
