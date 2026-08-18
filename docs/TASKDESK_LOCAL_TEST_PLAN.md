# TaskDesk local test plan

> Target branch: `v3/taskdesk`
>
> Purpose: validate TaskDesk/Harness 3 locally against real harness CLIs before Android/network variables are introduced.

## Important: New Task is still hidden in the normal app

The archived TaskDesk experiment never merged the final task-first UI, and upstream PR #172 ended with the feature intentionally disabled after the problematic test period.

This integration branch therefore **does not re-enable New Task in the normal Harness Remote UI**. Real TaskDesk testing uses an explicit browser-only integration surface:

```text
http://localhost:5173/?taskdesk-test=1
```

Without that query parameter, the normal application opens.

## Why browser first

```text
local browser -> TaskDesk test page -> local machine daemon -> real harness CLI
```

Only after this works should the same runtime be tested from Android. This isolates TaskDesk/daemon/harness failures from Capacitor, Wi-Fi, firewall and packaging problems.

## Checkout

```bash
git clone -b v3/taskdesk https://github.com/giuliastro/harness-remote.git
cd harness-remote
npm install
cd web
npm install
cd ..
```

Use Node.js 20 or newer.

## Terminal A: start the machine daemon

TaskDesk project/task/model endpoints live on the **machine daemon**, not on the legacy single-backend server. Do not use `--single` for the TaskDesk test page.

### Browser DEV testing requires CORS

The local Vite client runs on `http://localhost:5173` while the machine daemon normally runs on `http://localhost:4097`. These are different browser origins, so the daemon must allow the Vite origin during browser testing.

For the local TaskDesk browser test, start the daemon with CORS enabled for the dev origin:

```bash
npm start -- --cors http://localhost:5173
```

If testing through `127.0.0.1` or another host/IP, allow that exact browser origin as well.

This is a **browser/PWA requirement only**. The installed Electron desktop app and Android APK use native networking and should not require users to configure CORS. The final v3 user instructions must preserve that distinction rather than presenting `--cors` as a general Harness Remote requirement.

On a machine with several supported harnesses installed, the launcher detects the installed CLIs, chooses an ACP primary, and includes managed OpenCode when available. Record the daemon address, username and password printed in the terminal. The daemon normally uses port 4097; managed OpenCode normally stays internal on loopback port 4096.

To deliberately choose the ACP primary while testing, keep the browser CORS origin enabled:

```bash
npm start -- --backend codex --cors http://localhost:5173
npm start -- --backend claude --cors http://localhost:5173
npm start -- --backend omp --cors http://localhost:5173
npm start -- --backend pi --cors http://localhost:5173
```

Run one daemon process at a time.

### Separate legacy/single-backend sanity checks

The old single-backend paths can still be checked independently, but they are **not** the TaskDesk test surface:

```bash
npm start -- --backend opencode --single
npm start -- --backend codex --single
npm start -- --backend claude --single
npm start -- --backend omp --single
npm start -- --backend pi --single
```

Use these only to distinguish a general harness/bridge regression from a machine-daemon/TaskDesk regression.

## Terminal B: start the web client

```bash
cd web
npm run dev
```

Open the normal Vite URL first, normally:

```text
http://localhost:5173/
```

Configure/save the server profile pointing to the machine daemon from Terminal A. For a same-PC diagnostic pass, prefer `localhost`/`127.0.0.1`.

Then open:

```text
http://localhost:5173/?taskdesk-test=1
```

The TaskDesk test page uses the already-saved active profile and opens the isolated Task launch dialog directly.

## Browser diagnostics

Keep DevTools open:

- **Console**: JavaScript/runtime errors.
- **Network**: URL, duration, status, duplicate requests, pending requests and timeouts.
- Enable Preserve log when comparing first and second attempts.

For every failure record:

1. ACP primary and target agent;
2. exact action;
3. visible UI result;
4. request path/status/duration;
5. Console error;
6. whether retrying without restarting changes the result.

## Mandatory rollback-regression matrix

### A. Machine discovery / endpoint correctness

From the normal app save/connect the daemon profile, then open `?taskdesk-test=1`.

**Pass:** TaskDesk reaches the machine daemon and does not confuse a direct OpenCode endpoint (typically 4096) with the daemon endpoint (typically 4097).

### B. New Task model discovery

1. Fresh page load of `?taskdesk-test=1`.
2. Observe project and model discovery.
3. In Network inspect `/v1/projects` and `/v1/agents/<agent>/models`.
4. Record time until the model selector is usable.

**Pass:** catalog arrives promptly for the intended machine/agent, with no unrelated session requirement and no stale/error state.

### C. First attempt vs second attempt

1. Start from fresh daemon + page load.
2. Open the test page once and record model behavior.
3. Close the dialog/reopen New Task from the test page without restarting anything.

**Pass:** first and second attempts behave equivalently. "Fails first, works second" is a failure.

### D. Model refresh semantics

Open New Task repeatedly and inspect the model requests.

**ACP pass:** discovery reuses its durable prompt-less catalog session rather than creating an ever-growing pile of user-visible probe sessions.

**OpenCode pass:** managed HTTP catalog is refreshed and belongs to the OpenCode agent.

### E. Create + worktree + launch

Choose a project, model and prompt and start the task.

Record timing for:

```text
POST /v1/tasks
POST /v1/tasks/<id>/worktree     (Git + isolation enabled)
POST /v1/tasks/<id>/launch
```

**Pass:** selected model is stored on the task, freshly validated before launch, and the task enters its run lifecycle without a long unexplained pause.

### F. Model removed between picker and launch

Where practical, change/disable the selected model after the picker loaded but before launch, or reproduce with a controlled harness configuration.

**Pass:** launch fails clearly rather than silently falling back to a different model.

### G. Second task state leakage

Create a second task with a different project/model when possible.

**Pass:** no project, model, worktree or loading state from task 1 contaminates task 2.

### H. Restart behavior

Reload only the browser, then separately restart the daemon.

**Pass:** ACP catalog state can recover/reuse its durable catalog session; startup does not generate repeated user-facing model-probe sessions or an uncontrolled discovery loop.

## Agent coverage

The machine daemon has one ACP primary plus managed OpenCode. Repeat the daemon run with different ACP primaries where installed:

1. Codex
2. Claude
3. OMP
4. PI

For each run also test the managed OpenCode agent if available.

One backend passing is not evidence that the others are safe.

## Normal app compatibility sanity check

After TaskDesk testing, remove the query string and use normal Harness Remote against the same daemon:

```text
http://localhost:5173/
```

Open existing sessions, create a normal session and send a prompt on the relevant harnesses.

**Pass:** restoring TaskDesk machine/model infrastructure has not broken legacy session behavior.

## Android gate

Only after browser-local TaskDesk and normal-app sanity checks pass, keep the same PC daemon running and connect the debug APK over LAN. The normal mobile app should remain backward-compatible; TaskDesk should not be promoted into its ordinary UI until the browser workflow is proven.

## Result recording

Record outcomes in issue #197:

```text
ACP primary:
Target agent:
Build/commit:
Test case:
PASS / FAIL:
Observed latency:
Network evidence:
Console evidence:
Notes:
```

No promotion toward `main` is justified by automated CI alone. Real-harness browser testing and later Android testing are explicit gates.
