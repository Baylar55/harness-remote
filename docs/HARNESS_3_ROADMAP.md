# Harness 3 Product & Architecture Roadmap

> **Status:** product direction, not a promise that every item below will ship exactly as written.
>
> Execution is tracked in [roadmap issue #133](https://github.com/giuliastro/harness-remote/issues/133).

## 1. Vision

Harness Remote started as a companion application for controlling coding-agent harnesses away from the primary workstation. It already supports multiple backends and normalizes enough of their behavior to provide one client across OpenCode, OMP, PI, Claude Code and Codex CLI.

The next product step should not be to become a larger collection of remote-control adapters. The goal is to evolve into a **local-first control plane for AI coding agents**.

The product should eventually let a user:

- see all active agent work in one place;
- know immediately which agent needs attention;
- start work remotely, not only observe existing sessions;
- organize work around projects and tasks rather than around backend names;
- operate agents across more than one machine;
- review changes and complete the Git/PR lifecycle;
- keep execution, credentials and source code local by default;
- use different coding agents without making the user rebuild their workflow around each one.

A representative end-state summary is:

```text
3 machines
5 projects
8 active agent runs
2 need attention
```

The product should feel like the place where agent work is managed, while Codex, Claude Code, OpenCode, OMP, PI and future ACP-compatible agents remain the execution engines underneath.

## 2. Positioning

Harness should avoid competing with individual coding agents on their core strengths.

Claude Code should be free to become the best Claude coding environment. Codex should be free to become the best Codex environment. OpenCode and other harnesses should keep innovating independently.

Harness wins by owning the layer **above** them:

```text
                 Harness
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      Codex     Claude Code   OpenCode
        │           │           │
       OMP          PI       other ACP agents
```

The product proposition is therefore not:

> another coding agent

or even only:

> use your coding agent from your phone

It is:

> **one local-first control plane for all of your coding agents.**

Remote access remains important, but becomes a capability of the control plane rather than the entire identity of the product.

## 3. Product principles

### Agent-neutral

Backend identity must remain visible when it matters, but the primary workflow should not force the user to think in terms of providers first.

### Project- and task-centric

Users think in terms of `harness-remote`, `customer-api`, `fix issue #142`, and `review this PR` more naturally than in terms of `Codex session 123` or `OMP server 4097`.

The long-term hierarchy should move from:

```text
backend → session
```

Toward:

```text
project → task / agent run → machine → backend
```

### Attention first

As agent work becomes longer and more asynchronous, the critical question is:

> **Which agent needs me now?**

The UI should prioritize questions, permissions, failures and completed work that deserves review over passive session browsing.

### Local-first

Agent execution and credentials should stay on the user's machine by default. A hosted service may improve connectivity, but it should not become a requirement for ordinary local/LAN use.

### Capability-aware, not lowest-common-denominator

Harness should normalize common concepts without pretending every backend exposes the same features. Backend-specific capabilities should remain available where they provide value.

### Progressive complexity

The basic path must be simple. Advanced users can opt into multi-machine setups, relays, routing and orchestration later.

## 4. Target UX

### 4.1 Agent Inbox

The main screen should become an operational inbox rather than just a session browser.

```text
NEEDS YOU

Codex · harness-remote
Permission required
npm run release

Claude · customer-api
Question
Use PostgreSQL or SQLite?

WORKING

Codex   Fix issue #142         6m
OMP     Investigate tests     13m
Claude  Waiting for subagent   4m

RECENT

✓ Codex   PR ready
✓ Claude  Tests passed
✕ PI      Task failed
```

The first implementation is tracked by #131 and #132, with #130 preparing the UI structure.

### 4.2 Projects

Projects should become first-class navigation targets.

```text
Harness Remote
~/dev/harness-remote

● 2 working
! 1 needs attention

Codex    Fix issue #142
Claude   Review ACP architecture
OMP      idle
```

A project may contain work from multiple agents and, eventually, multiple machines.

### 4.3 New Task

Harness should eventually start work, not only monitor it.

```text
Project
Harness Remote

Task
Fix issue #142, run the test suite and explain the changes

Agent
Auto / Codex / Claude / OpenCode / OMP / PI

Workspace
New worktree / Existing checkout

[ Start task ]
```

`Auto` does not need to be intelligent initially. Agent routing belongs later in the roadmap.

### 4.4 Machines

A machine view should make multi-device execution understandable without exposing unnecessary transport details.

```text
Workstation · Windows
Codex      available
Claude     available
OpenCode   running
OMP        available
3 active tasks

MacBook · macOS
Claude     available
Codex      available
1 active task
```

### 4.5 Session detail

The existing chat/session experience remains valuable. It should become a focused detail view with clearer operational surfaces such as:

```text
Chat | Changes | Tasks | Logs
```

- **Chat:** conversation and direct steering
- **Changes:** file changes and diffs
- **Tasks:** normalized plan/todo information
- **Logs:** tool calls and lower-level activity

### 4.6 Git / PR lifecycle

Once a local daemon has direct access to the repository, Harness can add backend-independent value:

```text
agent finished
    ↓
review diff
    ↓
verify tests
    ↓
create PR
    ↓
track CI
    ↓
merge
```

This should be built as a Harness capability rather than separately for every coding agent.

## 5. Target architecture

The existing `bridge/` is a foundation to evolve, not something to discard.

Today it already contains important building blocks:

- ACP client/service logic;
- harness profiles;
- capability differences;
- history normalization;
- HTTP/SSE transport;
- session persistence and backend-specific handling.

The likely evolution is from a **single-backend bridge** into a **machine-level daemon** capable of hosting several agent runtimes concurrently.

```text
Harness client
      │
      ▼
Harness daemon
      │
      ├── Codex host ─── ACP adapter
      ├── Claude host ── ACP adapter
      ├── OMP host ───── ACP
      ├── PI host ────── ACP adapter
      └── OpenCode host ─ HTTP API
```

The client should increasingly consume normalized concepts such as:

- Machine
- Project
- AgentRun
- AttentionState
- Task

while still retaining access to backend-specific features where appropriate.

## 6. Zero-config direction

The current setup is powerful but too configuration-heavy for broad adoption. A target local setup should eventually be closer to:

```bash
npm install -g harness-remote
harness
```

with automatic discovery:

```text
Harness daemon
Machine: workstation

Detected agents:
✓ Codex
✓ Claude Code
✓ OpenCode
✓ OMP
✓ PI

Projects:
✓ ~/dev/harness-remote
✓ ~/dev/customer-api

Scan the QR code in Harness Remote to pair.
```

The user should not normally need to manually understand hostnames, ports, CORS and per-backend bridge commands just to get started.

## 7. Pairing and remote connectivity

Connectivity should be progressive.

### Level 1 — LAN / local

Default path. No account required.

### Level 2 — Existing VPN / private networking

Users who already rely on Tailscale or similar tools should be able to keep doing so.

### Level 3 — Optional Harness Relay

For true zero-config remote access:

```text
Phone
  │ encrypted
  ▼
Harness Relay
  │ encrypted
  ▼
Local daemon
```

The relay should be designed so it does not require plaintext access to prompts, model output or source code. A self-hostable relay path should remain possible.

## 8. Security principles

The control-plane direction must not weaken the current local-first safety posture.

- Agent credentials stay on the user's execution machine.
- Filesystem access is limited to explicitly permitted roots.
- Network exposure is authenticated.
- Pairing replaces manual credentials with a better UX, not weaker security.
- Remote relay design should avoid requiring plaintext access to source, prompts or responses.
- Direct LAN, VPN and self-hosted paths remain valid choices.
- Future team/enterprise features should add identity, RBAC and auditability without making those mandatory for personal use.

## 9. Roadmap phases

### Phase A — Attention

Build the first agent-control-plane behavior on top of the current architecture.

- #130 — extract session UI from `App.tsx` without behavior changes
- #131 — introduce normalized `AgentRun` and attention state
- #132 — build the Agent Inbox

**Outcome:** opening Harness immediately answers “Which agent needs me?”

### Phase B — Zero Config

Evolve the bridge into the machine-level foundation.

Planned areas:

- multi-agent daemon;
- automatic harness discovery;
- machine identity;
- QR/code pairing;
- project/repository discovery;
- simpler local setup.

**Outcome:** install once, pair once, discover available agents automatically.

### Phase C — Control Plane

Move from monitoring existing work to starting and completing work.

Planned areas:

- project-centric navigation;
- remote task launch;
- optional isolated Git worktrees;
- normalized task lifecycle;
- actionable questions and permissions;
- richer completion/failure notifications;
- diff/review flow;
- create PR;
- CI/PR visibility.

**Outcome:** start → monitor → steer → review → PR from one product.

### Phase D — Orchestration

Only after the fundamentals are reliable:

- `Auto` agent selection;
- availability/capability/cost/limit-aware routing;
- parallel runs;
- implementation/review multi-agent patterns;
- quota and usage visibility where reliable;
- optional hosted relay and self-hosted relay;
- team/enterprise control surfaces.

**Outcome:** Harness coordinates agent capacity rather than merely exposing it.

## 10. What not to prioritize yet

### Do not optimize for harness count alone

Adding agent after agent just to advertise a larger compatibility list is not the primary growth strategy. Generic ACP compatibility should make additional agents progressively cheaper to support.

### Do not build another coding agent

Harness should orchestrate and expose the strengths of existing agents rather than reproduce their reasoning, editing or terminal stacks.

### Do not build the cloud backend first

Local value must be strong independently of a hosted service.

### Do not add smart routing before task launch is solid

`Auto` is only valuable after Harness can reliably start and track tasks.

### Do not prioritize voice or live preview before the operational workflow

Both can become useful later, but neither is the core moat.

### Do not rewrite the existing product all at once

The transition should be incremental. Current users should keep a working remote client throughout the evolution.

## 11. Technical preparation

Before adding large new UI surfaces, the web application should continue decomposing `App.tsx` into cohesive feature-level components/modules. The goal is not architectural purity; it is preserving development velocity as Inbox, Projects, Machines and Tasks arrive.

Likewise, the bridge should evolve through small explicit steps rather than a replacement rewrite.

## 12. Success criteria

The transformation is working when users naturally describe Harness as the place where they manage coding-agent work rather than merely the app they use to open an existing session remotely.

Signals include:

- users operate more than one supported agent through Harness;
- the Agent Inbox becomes a primary entry point;
- task launch from Harness is routinely used;
- project/machine identity matters more than backend/server configuration;
- actionable notifications bring users back at the right moment;
- users complete a meaningful portion of the coding task lifecycle without returning to each agent's native UI;
- adding a new ACP-compatible agent requires little or no client redesign.

## 13. Canonical planning references

- [#133 — Harness 3 control-plane roadmap](https://github.com/giuliastro/harness-remote/issues/133)
- [#130 — Session UI extraction](https://github.com/giuliastro/harness-remote/issues/130)
- [#131 — AgentRun and attention model](https://github.com/giuliastro/harness-remote/issues/131)
- [#132 — Agent Inbox](https://github.com/giuliastro/harness-remote/issues/132)
- [#134 — Preserve this product/architecture roadmap](https://github.com/giuliastro/harness-remote/issues/134)

This document is the canonical **why and where**. GitHub issues remain the canonical **what next and how**.
