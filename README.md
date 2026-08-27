# Harness Remote

**Your sessions. Any coding agent. Any device.**

Harness Remote is a local-first control plane for AI coding agents. Connect the machines where your repositories, CLIs, subscriptions and credentials already live, then discover, observe and continue native coding-agent Sessions from desktop, web or Android.

> Harness Remote is not another coding agent. It is the control plane above them.

Execution stays on your machines. Repositories stay on your machines. Agent credentials and model access stay on your machines.

## Harness Remote 3.0

Harness Remote 3.0 is **Session-first**.

The primary user model is intentionally small:

```text
Machine
  Project
    Native Session
    Native Session
    ...
```

A **Project** is the real working directory/repository on one of your machines.

A **Native Session** is the real Session owned by OpenCode, Codex CLI, Claude Code, Oh My Pi or PI. Harness Remote does not create a competing Session abstraction above it.

A Session started in a native harness should be discoverable in Harness Remote where that harness exposes enough information. A Session started in Harness Remote is a real native harness Session and remains native-harness compatible where supported.

### Why Session-first

Modern coding agents already own the parts they understand best:

- transcript and history;
- reasoning and tool activity;
- permissions and questions;
- context and compaction;
- model behavior;
- Stop/cancel;
- resume semantics;
- native Session identity.

Harness Remote should preserve and orchestrate those capabilities, not rebuild them.

The 3.0 goal is simple:

> **Start anywhere. Continue anywhere. Switch agents when useful.**

Cross-agent continuation creates another real native Session and links it to the previous work. The user does not need to learn a separate Task or Conversation object just to find or continue a Session.

### Supported coding agents

The launcher currently recognizes:

- OpenCode
- Claude Code
- Codex CLI
- Oh My Pi (OMP)
- PI

Each adapter keeps its own native capabilities and limitations. Harness Remote does not invent features that the underlying harness does not expose.

### Release candidate status

Harness Remote 3.0 is now in **release-candidate validation** on:

```text
checkpoint/v3-session-first-working-2026-08-25
```

The current candidate includes the Session-first product model, native Session discovery and continuation, multi-machine support, model selection, live Activity, paging, desktop/web regression coverage and the rebuilt OMP ACP path.

The automated release gate is green on the current candidate. Real desktop/harness testing is considered passed for this RC. **Android/mobile manual validation is still required before the official 3.0 release.**

The stable `main` branch remains the 2.x line until the release candidate completes the final mobile gate and a dedicated 3.0 release PR is prepared.

## Quick start

Harness Remote uses one launcher per machine. The launcher detects supported coding-agent CLIs on `PATH` and exposes them behind one machine endpoint.

From a checkout or directly from GitHub:

```bash
npx github:giuliastro/harness-remote \
  --host 0.0.0.0 \
  --port 4097 \
  --username harness \
  --password "use-a-long-unique-password" \
  --root "$HOME/Software"
```

The values needed by a client are the machine address, public port, username and password. The normal public port is **4097**.

When several supported coding agents are installed, they remain behind the same machine endpoint. You do not create one connection profile per harness.

OpenCode may run as a managed internal host, normally on loopback port **4096**. Port 4096 is an implementation detail and should not be entered as the public machine port.

If `--port` is omitted, the launcher starts from the normal public port and chooses an available port when necessary. If username/password are omitted, it generates credentials and prints them.

## Connecting a machine

Open **Machines**, choose **Add machine**, and enter the address, public port and credentials printed by the launcher. Use **Test connection** before saving.

Harness Remote then discovers the machine, its Projects and the supported coding agents through that one connection.

The same machine configuration is used by desktop, Android and web clients.

## Working with native Sessions

The normal 3.0 flow is:

```text
choose machine
  -> choose project
  -> open an existing native Session
     or create a new native Session
  -> observe / continue / stop it according to harness capability
```

### Existing Sessions

Sessions created directly in a supported harness can appear in Harness Remote where native discovery is available.

Observation and writer ownership are separate capabilities. Harness Remote must not silently steal a native writer lock just because a Session can be read.

### New Sessions

**New Session** creates a real native Session on the selected machine, Project and harness.

When multiple machines are configured, the target machine is explicit.

### Continuing work

Continuing with the same harness resumes the same native Session where supported.

Continuing with another agent creates or resumes another real native Session and carries explicit continuity metadata rather than pretending the two harnesses share one native memory.

### Session fidelity

Release-critical rules include:

- each prompt reaches the intended native Session exactly once;
- no duplicate or empty user turns;
- no duplicate assistant turns;
- streamed output converges to the complete final answer;
- Activity appears live while the harness is working;
- Stop reaches the real native Session;
- model state does not leak between harnesses or machines;
- navigation does not make a live Session disappear or move unpredictably;
- old Session history remains readable;
- observation does not silently acquire writer ownership;
- restart/navigation preserves native Session identity where the harness supports it.

## Using the clients

- **Desktop (Windows, macOS, Linux):** install a desktop build, open **Machines**, and add the daemon address printed by the launcher.
- **Android APK:** install the APK and add the same machine endpoint. Android uses native HTTP transport, so browser CORS restrictions do not apply.
- **Web / PWA:** run the web client locally with `cd web && npm ci && npm run dev`, then open the URL printed by Vite. The daemon must allow that exact browser origin with `--cors`.
- **GitHub Pages:** the hosted stable client follows releases from `main`.

For example, to allow both the hosted client and a local Vite development client:

```bash
npx github:giuliastro/harness-remote \
  --host 0.0.0.0 \
  --port 4097 \
  --username harness \
  --password "use-a-long-unique-password" \
  --root "$HOME/Software" \
  --cors https://giuliastro.github.io \
  --cors http://localhost:5173
```

`--cors` accepts exact origins and may be repeated. It is needed only by browser clients, not by native Android or desktop clients.

## Root and Project access

`--root` defines the filesystem boundary the remote client may browse and use.

For example:

```bash
--root "$HOME/Software"
```

A path outside that boundary is intentionally rejected.

A normal 3.0 Session works in the selected Project's real directory. Harness Remote does not silently move normal work into a daemon-managed worktree.

## Development

Requirements:

- Node.js 20+
- one or more supported coding-agent CLIs installed on the host machine

Useful commands:

```bash
# Launcher / daemon from a checkout
npm start

# Bridge tests
npm test

# Web client
cd web
npm ci
npm run dev
```

Pull-request CI:

- type-checks and builds the web app;
- runs web regression tests;
- runs bridge tests on Linux, macOS and Windows;
- runs Chromium product smoke tests;
- builds and verifies a signed debug APK for release-candidate testing.

OMP also has an opt-in real adapter smoke:

```bash
cd bridge
npm run smoke:omp
```

That smoke creates real OMP Sessions and may spend real model usage, so it is intentionally not part of normal CI.

## Release path

Before Harness Remote 3.0 is promoted to `main`:

1. validate the exact release candidate on Android/mobile;
2. fix only release-blocking regressions on the RC line;
3. run the full automated gate again on the exact final SHA;
4. prepare release notes/versioning and a dedicated 3.0 PR toward `main`;
5. merge only after the final candidate is accepted.

Internal Task/Run compatibility code may remain after 3.0 if removing it would create release risk. That cleanup is post-release technical debt, not a user-facing product requirement.

## Documentation

- [Harness 3 roadmap](docs/HARNESS_3_ROADMAP.md)
- [Harness dependency notes](docs/DEPENDENCIES.md)
- [Legacy/full reference](REFERENCE.md)
- [Contributing](CONTRIBUTING.md)

The canonical execution and release plan remains GitHub issue **#197**.
