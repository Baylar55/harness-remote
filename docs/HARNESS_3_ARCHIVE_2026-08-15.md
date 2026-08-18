# Harness 3 archive — 2026-08-15

This branch preserves the Harness 3 work that had landed on `main` before the repository was restored to the last known-good pre-Harness-3 baseline.

## Stable baseline chosen for `main`

`923d62adf45a7a50a631203ee10ff6b5cc189fee` — `feat(web): enter key inserts a new line on touch devices (#129)`.

This is the last commit immediately before the Harness 3 roadmap/development sequence began with `5dc6081a5df6118ecba15beb419b5a02f0458970` (`docs: add Harness 3 product roadmap`). It therefore keeps the post-v2.10.3 fixes and contributor work that had already landed before Harness 3 started, including #120, #121, #125, #126, #127 and #129.

## Canonical roadmap

The full product/architecture direction remains in [`docs/HARNESS_3_ROADMAP.md`](./HARNESS_3_ROADMAP.md) on this archive branch. From this point forward, roadmap/backlog ideas should be consolidated in the roadmap rather than kept as a large set of open implementation issues while the stable product is being protected.

The following previously open issues are captured as roadmap/backlog concerns rather than active work items:

- #133 — stabilization/roadmap umbrella;
- #143 — reliable universal machine daemon;
- #145 — reliable end-to-end New Task/model lifecycle;
- #157 — TaskDeck rebrand without breaking existing installs;
- #180 — future machine-first client flow;
- #181 — PI/ACP prompt-boundary/session correctness discovered during Harness 3 testing.

Important compatibility rule for any future Harness 3 restart: **legacy per-harness behavior remains the acceptance baseline and must be proven on a real Android client before new architecture is merged into `main`.**

## Preserved merged Harness 3 history

The branch point itself preserves every Harness 3 commit that had landed on `main` through:

- `f29391b018082ca63e6133e79f2bb5f0a98ab1ca` — README clarification after the stabilization investigation.

Git history on this branch includes the one-command launcher, machine identity/registry, managed OpenCode host, machine daemon, scoped routing, machine-first client work, task/project/worktree/run/finish foundations, associated tests, and roadmap/positioning commits.

## Preserved unmerged PR work

These PRs are intentionally archival/reference work, not candidates to merge into the restored stable `main` as-is:

- #172 — `agent/task-control-plane-consolidated` @ `b1bd40006a95c49a8a71079acd269af5939cb7ce` — consolidated task-first/fleet/review work;
- #183 — `docs/stabilization-roadmap-2026-08-14` @ `bbd184e157ac0a3148d9ea9556b5c7b8a00af7aa` — stabilization roadmap rewrite;
- #184 — `agent/stabilize-machine-daemon-p0` @ `ef8c2737ef678be38e47d945a9532b83c685096c` — daemon credential stabilization slice;
- #185 — `agent/stabilize-new-task-models` @ `82106bbc1a49a541544107ebf4f94ed4bddca29d` — New Task/model-discovery experiments on top of #172;
- #190 — `fix/restore-v2.10.3-acp-service` — unsuccessful partial rollback experiment;
- #191 — `stabilize/restore-v2.10.3-main` — whole-tree rollback experiment used during diagnosis.

The branch and PR refs keep the code recoverable. Future Harness 3 development should start from the restored stable `main` and selectively reintroduce small, independently validated slices rather than merging these branches wholesale.

## Restart rule

Before any future Harness 3 slice lands on `main`:

1. stable OMP path passes on Android;
2. stable PI path passes on Android, including existing session, prompt/response, folder picker and new session creation;
3. existing direct profile URLs remain unchanged unless an explicit migration is reviewed;
4. web/bridge/Android CI passes;
5. new architecture remains additive until the old behavior has an equivalent real-device acceptance test.
