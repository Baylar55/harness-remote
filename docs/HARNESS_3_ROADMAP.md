# Harness 3 Product & Architecture Roadmap

> **Status:** product direction, not a promise that every item below will ship exactly as written.
>
> Execution is tracked in [roadmap issue #133](https://github.com/giuliastro/harness-remote/issues/133).

## 1. Vision

Harness Remote started as a companion for controlling coding agents away from the primary workstation. Remote control remains useful, but it is no longer a sufficient product identity.

Harness should evolve into a **local-first control plane for running AI coding work across the user's machines**.

Codex, Claude Code, OpenCode, OMP, PI and future ACP-compatible agents remain execution engines. Harness owns the workflow above them:

- machines;
- projects/repositories;
- available agents and capabilities;
- tasks, runs and workspaces;
- human attention;
- results and Git lifecycle.

A representative end state is:

```text
3 machines
5 projects
8 active agent runs
2 need attention
```

The product should feel like the place where agent work is managed, regardless of which supported agent executes it.

## 2. Positioning

Vendor-native products will provide excellent experiences for their own agents. Generic multi-agent orchestration is also an established category.

Therefore neither of these is enough by itself:

> use your coding agent from your phone

or:

> one control plane for all coding agents

The sharper proposition is:

> **Run and supervise AI coding work across your machines, from anywhere, while execution and credentials stay on them.**

The long-term hierarchy becomes:

```text
fleet → machine → project → task → agent run → backend
```

Backend identity stays visible when it matters but is not the primary navigation model.

## 3. Market context — August 2026

This section is dated deliberately so the strategy can be re-checked rather than inherited.

Observed category state:

- leading open orchestrators already provide one-command startup, isolated worktrees, multi-agent task launch, diffs/logs and PR-oriented workflows;
- worktree-per-task parallelism is table stakes rather than differentiation;
- mobile orchestration already has entrants;
- vendors increasingly own single-agent supervision;
- ACP adoption is broad, reducing the defensibility of backend normalization itself.

Implications:

### Generic control-plane positioning is a category description, not a wedge

Harness still needs to be agent-neutral, but neutrality alone is not a reason to switch.

### Setup friction is disqualifying

Zero-config is not Phase-B polish. In a market where competitors reach a working state with one command, it is a prerequisite for evaluation.

### Task launch and worktrees are cost of entry

Harness must be able to create work, not merely observe work started elsewhere.

### Multi-machine fleet management is the strongest currently identified wedge

The strongest scarce position found in the August 2026 review is a vendor-neutral, local-first control plane spanning multiple user machines.

This is a **current wedge, not a guaranteed permanent moat**. The compounding advantage should come from the graph Harness builds above it:

> machines × projects × agents × capabilities × tasks × attention × results

Sources for the market review are collected in the market-check comment on issue #133 and were introduced through PR #144.

## 4. Product principles

### Local-first

Agent credentials, execution and source stay on the user's machines by default. Cloud connectivity may improve access later but must not be required for ordinary local/LAN use.

### Agent-neutral

Harness should survive changes in agent/vendor. Backend-specific features remain available without dictating the whole workflow.

### Fleet-safe from the start

Machine identity and normalized APIs must not assume only one machine will ever exist.

### Task-centric

The durable unit is a task, not a chat session:

```text
start → work → human attention → verify → review → PR → finish
```

### Event-first where possible

Operational state and attention should prefer push/event-driven collection over polling fan-out, especially on mobile.

### Progressive complexity

Build explicit machine and agent selection before automatic routing. Build reliable task lifecycle before orchestration.

## 5. Core architecture

Evolve the existing `bridge/`; do not casually replace it.

The first target is one Universal Daemon per machine:

```text
Harness clients
      │
      ▼
Machine daemon
      │
      ├── AgentHost[codex]
      ├── AgentHost[claude]
      ├── AgentHost[opencode]
      ├── AgentHost[omp]
      └── AgentHost[pi]
```

Later, the control plane composes several daemons:

```text
Harness fleet
   │
   ├── Machine A daemon → agents / projects / tasks
   ├── Machine B daemon → agents / projects / tasks
   └── Machine C daemon → agents / projects / tasks
```

Each daemon should expose:

- stable machine identity;
- agent availability/capabilities;
- projects/repositories;
- sessions/runs/tasks;
- host health;
- an integration point for Attention Plane state.

## 6. Execution model — two parallel tracks

The roadmap is no longer one blocking sequence.

### Track 1 — Product / Adoption (priority)

#### P0 — Zero-config + Universal Daemon

Tracked by [#143](https://github.com/giuliastro/harness-remote/issues/143).

Target:

```bash
npx harness
```

or an equivalently low-friction first run.

Expected result:

```text
Harness daemon
Machine: workstation

Detected agents
✓ Codex
✓ Claude Code
✓ OpenCode
✓ OMP
✓ PI
```

One connection represents one machine and all supported local agents. The API is fleet-safe even though multi-machine aggregation is not yet implemented.

#### P1 — Create work

Tracked by [#145](https://github.com/giuliastro/harness-remote/issues/145).

Target:

```text
Project      harness-remote
Task         Fix issue #200 and run tests
Machine      Workstation
Agent        Codex
Workspace    New worktree
```

Remote task launch and safe worktree isolation are table stakes.

#### P2 — Multi-machine Fleet

Tracked by [#146](https://github.com/giuliastro/harness-remote/issues/146).

Target:

```text
Workstation
  Codex      working
  Claude     available

MacBook
  Claude     working
  Codex      available

Server
  OMP        working
```

The first version uses explicit machine placement. `Machine: Auto` comes later.

#### P3 — Finish work

Planned follow-ups:

- diff/review;
- test/check status;
- create PR;
- CI/PR visibility;
- task/worktree cleanup and completion lifecycle.

#### P4 — Coordinate

Only after the fundamentals are reliable:

- `Auto` agent selection;
- `Auto` machine selection;
- availability/capability/cost/rate-limit/workload-aware routing;
- parallel implementation/review workflows;
- optional E2E hosted relay and self-hosted relay;
- later team/RBAC/audit surfaces.

### Track 2 — Attention (parallel, non-blocking)

Completed:

- #130 — session UI extraction;
- #131 — normalized `AgentRun`.

Current:

- [#141](https://github.com/giuliastro/harness-remote/issues/141) — deferred ACP permissions split into bridge mechanics and real-harness compatibility;
- [#142](https://github.com/giuliastro/harness-remote/issues/142) — backend-neutral Attention Plane;
- [#132](https://github.com/giuliastro/harness-remote/issues/132) — Agent Inbox component.

Important sequencing decisions:

- #141 Track A is testable now with ACP doubles;
- #141 Track B waits for real ACP-backed harness environments and does not block Track 1;
- #142 can proceed without the full compatibility matrix, gating only backend-specific permission policy;
- #132 can ship as a component after #142 for the active connection;
- the Inbox should become the default launch screen/product story only after #143/#145 create enough concurrent work to justify it;
- after #146 the same surface can become a fleet-wide **Needs You** view.

## 7. Attention Plane

Attention should normalize moments where autonomous work needs a human:

- question / decision required;
- permission where safely supported;
- failed run;
- completed work awaiting review;
- later machine/policy problems.

Lifecycle:

```text
raised → pending → answered/acknowledged → cleared
```

The Attention Plane must be knowable without opening session detail and must use machine-scopable identifiers so fleet aggregation composes naturally later.

Deferred ACP permission support remains opt-in only where real harness evidence supports it.

## 8. Agent Inbox

The Inbox is a useful component, particularly on mobile, but not the current market wedge.

Before the daemon/task launcher it may accurately represent only the active connection. It must not fabricate cross-backend coverage by polling every saved profile.

After fleet support, its strongest form is:

> **Which agent across all my machines needs me now?**

A prioritized list is especially suited to phones, where desktop-style kanban boards scale poorly.

## 9. Connectivity

Connectivity should remain progressive:

1. local/LAN, no cloud account required;
2. existing private networking such as VPN/Tailscale;
3. optional Harness Relay for zero-config remote access.

A future relay should not require plaintext access to prompts, output or source code, and a self-hostable path should remain possible.

## 10. Security principles

- credentials remain on each execution machine;
- filesystem roots remain explicit;
- no unauthenticated non-loopback exposure;
- pairing/machine identity must preserve or strengthen authentication;
- an unreachable machine is represented as unreachable, not empty;
- deferred permissions require explicit timeout/disconnect fallback semantics;
- source code does not need to be centralized to manage the fleet;
- relay design should avoid plaintext application payloads.

## 11. Defensibility test

For each proposed feature ask:

> Does this make Harness harder to replace with one vendor's native remote UI or with a single-machine orchestrator?

Higher-value work:

- dramatically lowers first-run friction;
- works across competing agents;
- spans multiple user machines;
- compounds machine/project/task knowledge;
- creates durable task lifecycle above sessions;
- turns attention into a fleet-level human queue;
- later uses the graph to choose both machine and agent.

Low strategic value on its own:

- “remote Codex/Claude but nicer”;
- raw harness-count expansion;
- another generic kanban board;
- presenting worktrees as unique differentiation;
- smart routing before reliable task launch.

## 12. Current priority map

```text
PRODUCT / ADOPTION
#143 Zero-config + Universal Daemon
   ↓
#145 Task launch + worktree
   ↓
#146 Multi-machine Fleet
   ↓
Review / PR lifecycle
   ↓
Auto machine + agent routing / orchestration

ATTENTION (parallel)
#141 Track A mechanics ──→ #142 Attention Plane ──→ #132 Inbox component
#141 Track B real-harness compatibility ─────────→ ACP permission policy
```

## 13. Success criteria

Harness is making the transition when users describe it as the place they manage agent work across their machines rather than merely the app they use to open one agent session remotely.

Signals include:

- first run approaches one-command evaluation;
- users operate more than one agent through one daemon;
- tasks are routinely launched from Harness;
- worktree isolation is reliable;
- more than one machine can participate in the same control plane;
- machine/project/task identity matters more than server-profile configuration;
- attention becomes a useful fleet-level mobile surface;
- users can complete a meaningful portion of the task lifecycle without returning to each agent's native UI.

## 14. Strategic questions to keep revisiting

1. Is multi-machine fleet management still scarce as competitors evolve?
2. Is #143 narrow enough to ship quickly while actually achieving low-friction evaluation?
3. What is the minimum #145 scope required to be compared fairly with current orchestrators?
4. Does #146 create a real reason to switch or merely another copyable feature?
5. Which fleet graph data becomes compounding value rather than incidental metadata?
6. What assumption should be falsified before investing in hosted relay or automatic routing?

Concrete code- and market-based criticism is preferred over agreement.

## 15. Canonical planning references

- [#133 — execution roadmap](https://github.com/giuliastro/harness-remote/issues/133)
- [#143 — Universal Daemon / zero-config](https://github.com/giuliastro/harness-remote/issues/143)
- [#145 — task launch / worktree](https://github.com/giuliastro/harness-remote/issues/145)
- [#146 — multi-machine fleet](https://github.com/giuliastro/harness-remote/issues/146)
- [#141 — deferred ACP permission mechanics/compatibility](https://github.com/giuliastro/harness-remote/issues/141)
- [#142 — Attention Plane](https://github.com/giuliastro/harness-remote/issues/142)
- [#132 — Agent Inbox](https://github.com/giuliastro/harness-remote/issues/132)

This document is canonical **why and where**. GitHub issues remain canonical **what next and how**.