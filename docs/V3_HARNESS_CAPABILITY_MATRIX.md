# Harness Remote 3.0 harness capability matrix

This document records the runtime contract Harness Remote 3.0 expects from each supported coding harness.

The model list is only one part of that contract. Harness Remote also needs to know how a harness communicates, how tool activity is represented, which model controls are actually advertised, which component owns Session truth, and which lifecycle guarantees can be relied on.

The machine snapshot exposes the same structured information as `agent.contract`. Boolean capability flags remain for compatibility, while the structured contract is the 3.0 direction.

## Product rule

Harness Remote owns the **Conversation** continuity layer. The coding harness owns its **Native Session**.

Harness Remote must not flatten harness-specific capabilities into a fake universal Session protocol. If a harness does not advertise a control, Harness Remote does not invent it.

## Matrix

| Harness | Protocol / control | Live events | Tool representation | Model source | Catalog scope | Model controls | Session authority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenCode | HTTP JSON | daemon-owned SSE fanout | OpenCode message parts | runtime `/provider` or `/api/provider`; `/config/providers` compatibility fallback | machine | provider-advertised variants | OpenCode |
| OMP | ACP over stdio JSON-RPC | ACP Session updates | ACP Session updates | fresh prompt-less technical ACP Session `configOptions` | Project / cwd | `thinking` only when advertised | OMP |
| PI | ACP over stdio JSON-RPC | ACP Session updates | ACP Session updates | fresh prompt-less technical `pi-acp` Session `configOptions` | Project / cwd | `thinkingLevel`, compatible runtime aliases only when advertised | PI |
| Codex | ACP over stdio JSON-RPC | ACP Session updates | ACP Session updates | fresh prompt-less technical ACP Session `configOptions` | Project / cwd | `reasoning_effort` only when advertised | Codex |
| Claude | ACP over stdio JSON-RPC | ACP Session updates | ACP Session updates | fresh prompt-less technical ACP Session `configOptions` | Project / cwd | runtime-advertised controls only; no fabricated reasoning levels | Claude |

## Model discovery scope

ACP harness configuration can depend on the Project directory. Harness Remote therefore treats ACP model discovery as scoped by:

```text
machine + harness + Project/cwd
```

The browser or Android client does not send an arbitrary filesystem path to the model endpoint. It sends either:

- `projectId` for New Conversation; or
- `workThreadId` for an existing Conversation.

The daemon resolves that identifier to an already-authorized Project or persisted Conversation workspace and only then passes the directory to the catalog.

Each authorized ACP directory has its own:

- cached model catalog;
- single-flight discovery operation;
- prompt-less technical Session;
- refresh/error state;
- variant-probe state.

Those scopes share the same model-discovery ACP adapter process. Harness Remote does not spawn a second PI or OMP CLI as a competing model authority.

OpenCode remains machine-scoped because its runtime provider inventory is obtained from the managed OpenCode host rather than from a Project-scoped ACP Session.

## Lifecycle contract

### Conversation

Harness Remote owns:

- stable Conversation identity;
- Project association;
- ordered Native Session references;
- current harness/model selection;
- explicit handoff context between Native Sessions;
- retry/reconciliation metadata needed above the harness layer.

### Native Session

The selected harness owns:

- native transcript and message semantics;
- reasoning/activity representation;
- tool execution and tool state;
- questions and permissions when supported;
- native context/memory/compaction;
- model behavior;
- abort/Stop behavior;
- native resume semantics.

### Create, resume and Stop

The structured runtime contract currently describes the intended routing semantics as:

- create: native harness Session;
- resume: native Session when the harness supports it;
- Stop: native abort/cancel path;
- reconnect: daemon transport reconciliation rather than blindly replaying a prompt.

Exact real-machine behavior is still part of the 3.0 release gate. This matrix documents the contract and implementation path; it does not replace validation against installed OpenCode, OMP, PI, Codex and Claude builds.

## Transport notes

### OpenCode

OpenCode uses HTTP for control. Harness Remote owns one upstream OpenCode global SSE connection and fans events out to downstream web, desktop and Android clients. Reconnecting clients must not create an unbounded number of OpenCode upstream subscriptions.

### ACP harnesses

OMP, PI, Codex and Claude are controlled through ACP adapters over stdio JSON-RPC. Session updates carry the harness-native activity through the ACP representation. Model discovery uses a separate prompt-less technical ACP connection from user-facing Session ownership so discovery cannot take over a Conversation Session.

## Variant and reasoning metadata

Harness Remote preserves controls that the running harness actually advertises:

- OMP: `thinking` when advertised;
- PI: `thinkingLevel` or compatible runtime aliases when advertised;
- Codex: `reasoning_effort` when advertised;
- Claude: no fabricated low/medium/high levels;
- OpenCode: provider-advertised variants.

A base model remains usable if optional variant enrichment is slow or incomplete.

## Diagnostics

The 3.0 backend exposes diagnostics for model discovery and lifecycle investigation, including:

- catalog source and cache scope;
- cached model count and age;
- in-flight discovery state;
- ACP discovery phase;
- variant-probe completeness;
- scoped Project/cwd catalog state;
- active/queued Sessions;
- pending ACP requests;
- event stream and reconnect counters;
- OpenCode upstream/downstream fanout state.

Diagnostics must not expose prompt bodies, credentials or generated authentication material.

## Release validation still required

Before 3.0 promotion, validate the contract with real installed harnesses on one exact candidate SHA:

1. discover/start each harness;
2. load models in at least two Projects where practical;
3. create a Conversation;
4. continue across multiple turns;
5. run a long reasoning/tool turn;
6. Stop a real turn;
7. switch harness and model;
8. switch away and back;
9. restart daemon and reconcile/resume;
10. background/foreground Android or interrupt the local network;
11. prove listener, request, cache and subscription counts plateau.

The final release matrix must distinguish what was **implemented**, what was **advertised by the harness**, and what was **verified on a real machine**.
