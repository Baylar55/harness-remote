# Harness Remote

**Your projects. Any coding agent. One workspace.**

Harness Remote is a local-first control plane for AI coding agents. Connect the machines where your repositories, CLIs, subscriptions and credentials already live, then use OpenCode, Claude Code, Codex CLI, Oh My Pi and PI from one interface on phone, web or desktop.

> Harness Remote is not another coding agent. It is the control plane above them.

Execution stays on your machines. Repositories stay on your machines. Agent credentials and model access stay on your machines.

## Harness Remote 3.0

Harness Remote 3.0 changes the center of the product from **remote agent Sessions** to **persistent work Conversations**.

The idea is simple:

> Start with any agent. Continue with another. Keep the same piece of work.

A modern coding agent already knows how to own a Session: transcript, tools, reasoning, permissions, context, memory, model behavior and resume semantics. Harness Remote should not rebuild that layer.

Instead, 3.0 adds the continuity layer that individual coding agents cannot provide on their own.

```text
Machine
  Project
    Conversation
      Native Session: OpenCode
      Native Session: Codex
      Native Session: Claude
```

A **Project** is the real workspace on one of your machines.

A **Conversation** is the persistent piece of work you see and return to in Harness Remote. It belongs to a Project and can continue across coding agents.

A **Native Session** is the real harness-owned Session underneath that Conversation. OpenCode, Codex, Claude, OMP and PI keep ownership of their own history and runtime behavior.

### Conversation vs Native Session

| | Conversation | Native Session |
|---|---|---|
| Owned by | Harness Remote | The coding agent / harness |
| Purpose | Keep one piece of work continuous across agents | Execute work inside one specific agent |
| Scope | Project-level, cross-agent | Harness-specific |
| Stable identity | Yes | Depends on the harness |
| Can switch coding agent | Yes | No, it belongs to one harness |
| Transcript/tool semantics | Does not redefine them | Native to the harness |
| Reasoning, tools, permissions, memory | Orchestrated, not reimplemented | Owned by the harness |
| Model and agent-specific capabilities | Selected through the control plane | Applied by the native harness |

This distinction is central to 3.0. Harness Remote is not trying to create a universal fake Session format. It keeps enough continuity to let you move between agents while preserving the native Session as the source of truth.

### One Conversation, several agents

For example, one Project Conversation might evolve like this:

```text
Conversation: "Refactor authentication"

1. OpenCode Session
   explore the repository and identify the current auth flow

2. Codex Session
   continue the same work and implement the refactor

3. Claude Session
   review the resulting design and find edge cases
```

From the user's point of view this is still one Conversation. Underneath, each coding agent works through its own native Session.

The **Sessions** view exists precisely to make that native chain visible instead of hiding it.

The **Changes** view remains grounded in the real Project workspace.

### Why this matters

Coding agents change quickly. The best agent, model or subscription for one step may not be the best one for the next step.

Harness Remote 3.0 is designed so the workspace and the work survive that choice:

- start a Conversation with the agent and model you want;
- work directly in the real Project directory;
- continue the same Conversation with another agent when useful;
- create or resume the appropriate native Session for that agent;
- preserve explicit continuity between those Sessions;
- inspect the native Session chain instead of replacing it with a second competing protocol;
- supervise the same work from desktop, web or Android.

A normal Conversation does **not** create a hidden Git worktree. Isolation may be added explicitly for true parallel work, but it is not the default workspace model.

### 3.0 status

Harness Remote 3.0 is currently in pre-release audit and integration work. The conversation-first UI is usable, while the final release gate is focused on real-harness reliability, transport/reconnect behavior, capability discovery and cross-agent continuity.

The stable `main` branch remains the 2.x line until the 3.0 candidate completes those gates.

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

The important values for a client connection are the machine address, public port, username and password. The normal public port is **4097**.

The launcher currently recognizes:

- OpenCode
- Claude Code
- Codex CLI
- Oh My Pi (OMP)
- PI

When several supported agents are installed, they all remain behind the same machine endpoint. OpenCode can run as a managed internal host, normally on loopback port **4096**. Port 4096 is an implementation detail and should not be entered as the public machine port.

If `--port` is omitted, the launcher starts from the normal public port and chooses an available port when necessary. If username/password are omitted, it generates credentials and prints them.

## Connecting a machine

Open **Machines**, choose **Add machine**, and enter the address, public port and credentials printed by the launcher. Use **Test connection** before saving.

Harness Remote then discovers the machine, its projects and all supported coding agents through that one connection. You do not create a separate connection profile for every harness.

The same machine configuration is used by desktop, Android and web clients.

## Using the clients

- **Desktop (Windows, macOS, Linux):** install a desktop build, open **Machines**, and add the daemon address printed by the launcher. Desktop does not need browser CORS configuration.
- **Android APK:** install the APK and add the same machine endpoint. Android uses native HTTP transport, so browser CORS restrictions do not apply.
- **Web / PWA:** run the web client locally with `cd web && npm ci && npm run dev`, then open the URL printed by Vite. Because this is a browser client, the daemon must allow that exact web origin with `--cors`.
- **GitHub Pages:** the stable hosted client follows releases from `main`. To connect from it, allow the hosted origin with `--cors https://giuliastro.github.io`.

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

## Root and project access

`--root` defines the filesystem boundary the remote client is allowed to browse and use. Pick a directory containing the projects Harness Remote may access, for example:

```bash
--root "$HOME/Software"
```

A path outside that boundary is intentionally rejected.

The normal 3.0 workflow selects a known **Project** and starts its Conversation in that project's real directory. Harness Remote does not silently relocate normal work into a daemon-managed worktree.

## Conversation continuity

Each coding agent keeps its own native Session format and behavior.

When a Conversation continues with the same agent, Harness Remote resumes the most recent compatible native Session when possible. When it continues with another agent, Harness Remote creates or resumes that agent's native Session and transfers explicit continuity context.

If a previously persisted native Session is no longer available, Harness Remote can create a new native Session and continue from persisted Conversation context rather than exposing an implementation-level Session ID failure to the user.

The **Sessions** tab makes this chain visible. The **Changes** tab stays grounded in the current Project workspace.

## What remains native

Harness Remote should orchestrate capabilities that coding agents already implement instead of cloning them. Native Session history, context compaction, tool execution, reasoning, permission requests, questions, model behavior and harness-specific memory remain owned by the harness whenever possible.

Harness Remote adds the layer that an individual harness cannot provide by itself:

- one machine connection for multiple coding agents;
- one Project workspace across agents;
- one Conversation that can continue through several native Sessions;
- agent and model switching from the same interface;
- remote supervision from desktop, web and Android;
- local execution with the user's existing credentials and subscriptions.

## Legacy compatibility

The repository still contains lower-level bridge and compatibility code because stable 2.x installations may depend on it. Existing internal Task/Run naming is also retained where changing it would create unnecessary compatibility risk. Those implementation details are not the 3.0 product model.

For low-level legacy setup details see [REFERENCE.md](REFERENCE.md).

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

Pull-request CI type-checks and builds the web app, runs regression and bridge tests on Linux/macOS/Windows, verifies the desktop application menu and produces a signed debug APK for test candidates.

## Documentation

- [Harness 3 roadmap](docs/HARNESS_3_ROADMAP.md)
- [Harness dependency notes](docs/DEPENDENCIES.md)
- [Legacy/full reference](REFERENCE.md)
- [Contributing](CONTRIBUTING.md)

## Project status

The 3.0 release path is moving Harness Remote from a remote Session viewer to a conversation-first universal agent control plane.

The release gate is practical: each supported harness must route to the correct native Sessions and models, cross-agent continuation must preserve useful context, the Project workspace must remain predictable, desktop/web/Android must behave consistently, and the exact candidate SHA must pass both automated checks and real-harness manual testing before promotion.
