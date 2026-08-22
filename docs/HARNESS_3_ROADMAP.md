# Harness Remote 3.0 Product & Architecture Roadmap

> **Canonical execution plan:** issue #197.
>
> This document explains the product direction and sequencing rationale. Issue #197 remains the release and implementation authority.

## 1. Vision

Harness Remote 3.0 is the **vendor-neutral, local-first control plane for coding-agent conversations**.

It does not try to become another coding agent, another task manager, or another implementation of features already owned by Codex, Claude Code, OpenCode, OMP, PI and future harnesses.

The product promise is:

> **Your projects. Any coding agent. One workspace.**

The user-facing model is deliberately small:

```text
Machine
  Project
    Conversation
      Native Session
      Native Session
      ...
```

A Conversation can begin with one coding agent and continue with another. The underlying Sessions remain real native Sessions owned by their harnesses.

## 2. Why this direction

The coding-agent market has moved quickly. Modern harnesses already provide sophisticated Session history, compaction, memory, tools, permissions, Git workflows, background execution and increasingly strong remote experiences.

Rebuilding those capabilities above every harness would create a weaker duplicate and force Harness Remote to chase each vendor indefinitely.

Harness Remote instead owns the layer no single vendor is naturally motivated to provide:

- one machine connection for several coding agents;
- one project surface across agents;
- one Conversation that can span several native Sessions;
- explicit continuation between vendors;
- one remote interface on desktop, web and Android;
- local execution with the user's existing repositories, credentials and subscriptions.

Harness count matters as coverage, not as the product vision. The important capability is that the user's work is not locked to one harness.

## 3. Product boundary

### Harness Remote owns

- Machines and machine discovery;
- Projects and filesystem boundaries;
- coding-agent discovery and capability metadata;
- per-agent model catalogs;
- Conversation identity and title;
- ordered references to native Sessions;
- agent/model continuation and handoff;
- minimal cross-Session recovery metadata;
- remote supervision, attention and Stop controls;
- project Changes inspection;
- desktop, web and Android product experience.

### Native harnesses own

- Session history;
- native context and memory;
- compaction;
- reasoning and assistant output;
- tool execution;
- permissions and questions;
- model behavior;
- harness-specific Git features;
- native Session resume semantics.

The architecture rule is simple:

> If a harness already owns a capability well, Harness Remote should orchestrate it rather than clone it.

## 4. Conversation continuity

A Conversation is intentionally thinner than the previous Task concept.

It stores only what is required to keep one piece of work coherent across native Sessions.

### Same coding agent

When possible, resume the most recent compatible native Session.

If the Session no longer exists, create a new native Session and transfer the minimum useful continuity context.

### Different coding agent

Create or resume the target agent's native Session and pass an explicit handoff containing relevant state such as:

- current objective;
- important decisions;
- unresolved work;
- recent outcomes;
- project/workspace state;
- changed files;
- checks already run.

Harness Remote must never pretend that native memory from one vendor magically became native memory in another.

### Returning to a previous agent

Resume that agent's existing native Session when possible, then supply only the intervening context needed to catch it up.

## 5. Workspace model

The normal Conversation runs in the selected Project's real directory.

```text
Project /home/user/Software/harness-remote
  Conversation A -> native Session
  Conversation B -> native Session
```

A hidden daemon-managed worktree is **not** the default.

Worktree isolation remains useful for deliberate parallel work, but it must be an explicit user choice with visible branch, path and lifecycle. It is a workspace option, not the reason a Conversation exists.

## 6. Primary experience

The 3.0 shell should make the product understandable without documentation.

```text
Workspace
  Machines
  Projects
  Coding agents
  Conversation filters

Project
  Conversations
    Chat
    Sessions
    Changes
```

Core actions:

### New conversation

Choose:

- Machine;
- Project;
- coding agent;
- model;
- first message.

Start in the real Project directory.

### Continue with

Inside a Conversation, change coding agent or model and send the next instruction.

Harness Remote performs the native Session resume/create and continuity handoff.

### Sessions

Show the actual native Session chain, including agent changes and native Session IDs for inspection.

### Changes

Show the real Project workspace changes without inventing a separate source-control lifecycle.

## 7. What 3.0 removes from the primary product

The following are no longer first-class product concepts:

- visible Task versus Session choice;
- separate Classic mode;
- separate Advanced Native Sessions mode;
- automatic hidden worktree creation;
- a Task transcript that competes with the native Session transcript;
- Run as something the user must understand;
- task-manager language such as queue/complete/archive unless a future feature genuinely requires it.

Existing Task/Run storage and compatibility code may remain internally during migration. Internal persistence names do not define the product model.

## 8. Existing strengths we keep

The new direction does not discard the useful v3 foundation.

Keep and harden:

- one-command machine launcher;
- Universal Daemon;
- multiple agent hosts behind one machine endpoint;
- machine identity;
- project discovery;
- model discovery;
- agent-scoped routing;
- native message paging;
- live event routing;
- permissions/questions;
- Stop;
- Android native HTTP transport;
- desktop request/event transport;
- theme and language preferences;
- long-conversation performance work;
- shared conversation rendering;
- restart reconciliation and missing-Session recovery where still relevant.

## 9. Differentiation

Harness Remote should not compete with Codex by being a worse Codex UI or with Claude by being a worse Claude UI.

It should become more useful as the agent market becomes more competitive.

The durable wedge is:

### Agent independence

A Project and its Conversations survive a change of coding agent or vendor.

### Local-first execution

Code, credentials, subscriptions and runtimes remain on the user's machines.

### Universal remote surface

The same Conversations can be supervised from desktop, web and Android.

### Multi-machine reach

One control plane can eventually span the user's workstation, laptop, server or VM without centralizing source code or provider credentials.

Multi-machine remains strategically useful, but it should extend the Conversation model rather than replace it with a fleet/task-manager product.

## 10. Harness expansion strategy

Supporting more coding agents is valuable when each adapter preserves native behavior well.

Priority order:

1. make OpenCode, Codex, Claude, OMP and PI reliable;
2. make cross-agent continuation trustworthy;
3. make adapter contracts inexpensive to implement and test;
4. add high-demand harnesses and ACP-compatible agents;
5. never sacrifice fidelity merely to increase the supported-agent count.

A long compatibility list is not a moat by itself. Reliable interoperability is.

## 11. Attention and supervision

Questions, permissions, failures and Stop remain important because remote supervision is a core Harness Remote use case.

The UI should normalize these only enough to make them actionable from one surface. It should not hide harness-specific meaning when that meaning matters.

A future cross-machine "Needs you" view can aggregate real native attention events without introducing a separate Task lifecycle.

## 12. Performance rules

Conversation fidelity and responsiveness are release blockers.

Required behavior:

- typing remains immediate in long conversations;
- native messages are not duplicated;
- reasoning/tools do not become duplicate assistant replies;
- streamed output does not cause excessive React/DOM churn;
- scroll position remains stable;
- old history loads explicitly and predictably;
- live events are primary, reconciliation is a safety net;
- model catalog requests cannot race across agent changes;
- subscriptions do not leak;
- Stop reaches the real native Session;
- permissions/questions remain actionable.

## 13. Security principles

- credentials remain on execution machines;
- source code does not need to be centralized;
- filesystem roots stay explicit;
- non-loopback exposure remains authenticated;
- machine identity/pairing must preserve or strengthen authentication;
- a future relay should not require plaintext access to source, prompts or output;
- LAN, VPN and self-hosted paths remain valid.

## 14. What not to optimize for

Do not prioritize:

- raw harness count as the main success metric;
- a generic task/kanban board;
- mandatory worktree-per-item execution;
- features already better implemented by native harnesses;
- automatic routing before continuation is reliable;
- a hosted cloud backend before local value is excellent;
- architectural abstractions that cannot be explained to a user in one sentence.

## 15. RC1

Current implementation path:

- branch: `feature/conversation-control-plane-rc1`;
- draft PR: #286;
- base: `v3/taskdesk`;
- canonical plan: issue #197.

RC1 must demonstrate the vision, not just rename Task to Conversation:

1. direct conversation-first boot;
2. no Classic/Advanced product modes;
3. machine/project/agent/model selection;
4. New conversation in the real Project directory;
5. high-fidelity native chat;
6. Continue with another agent/model;
7. native Session continuity view;
8. Changes view;
9. permissions/questions and Stop;
10. desktop/web/Android navigation;
11. retained settings;
12. green automated tests and APK build;
13. real-harness manual validation before promotion.

## 16. Success criterion

Harness Remote 3.0 succeeds when the user can say:

> **I open my project, start with the coding agent I want, and continue with another whenever I want without losing the work or learning the plumbing underneath.**

It has failed if the user has to ask:

- Should I create a Task or a Session?
- Why does Harness Remote show a different chat from my native Session?
- Where did my code go?
- Why did changing agent lose context?
- Why is there a separate mode just to see the real Session?
