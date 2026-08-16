# TaskDesk local test plan

> Target branch: `integration/nitsuga-taskdesk`
>
> Purpose: validate TaskDesk/Harness 3 behavior locally on a PC that has the real harness CLIs installed, before Android/network variables are introduced.

## Why test in the browser first

The first gate should isolate the product logic:

```text
local browser → TaskDesk web client → local Harness runtime → real harness CLI
```

Only after that works should the same runtime be tested from Android over the LAN. This separates client/backend bugs from Capacitor, Wi-Fi, firewall and packaging problems.

## Checkout

```bash
git clone https://github.com/giuliastro/harness-remote.git
cd harness-remote
git checkout integration/nitsuga-taskdesk
```

Install dependencies:

```bash
npm install
cd web
npm install
cd ..
```

Use Node.js 20 or newer.

## Terminal A — start Harness runtime

### Preferred first pass: one harness at a time

Start with OpenCode:

```bash
npm start -- --backend opencode --single
```

Then repeat independently for ACP-backed harnesses available on the machine:

```bash
npm start -- --backend codex --single
npm start -- --backend claude --single
npm start -- --backend omp --single
npm start -- --backend pi --single
```

Use only one command/process at a time. Record the address, port, username and password printed by the launcher.

### Multi-harness pass

After the single-backend flows are understood:

```bash
npm start
```

When multiple supported CLIs are installed, the launcher can use the machine-daemon path and expose the detected harnesses through one connection.

## Terminal B — start the web client

```bash
cd web
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`.

Configure the server using the local runtime address printed by Terminal A. When both browser and runtime are on the same PC, prefer `localhost`/`127.0.0.1` for the diagnostic pass.

## Browser diagnostics

Keep DevTools open during all TaskDesk tests:

- **Console**: JavaScript/runtime errors.
- **Network**: request URL, duration, status, duplicate requests, pending requests and timeouts.
- Preserve the Network log when reproducing a first-attempt/second-attempt difference.

For every failure record:

1. harness/backend;
2. exact action performed;
3. visible UI result;
4. relevant request path/status/duration;
5. Console error, if any;
6. whether retrying without restarting changes the result.

## Mandatory rollback-regression matrix

Run these against each backend where the feature is supported.

### A. New Task model discovery

1. Start from a fresh page load.
2. Open New Task.
3. Select project/directory/worktree input as appropriate.
4. Observe time until model list becomes usable.
5. Record every model request in Network.

**Pass:** list arrives promptly, once for the intended context, with no stale/error state.

### B. First attempt vs second attempt

1. From a fresh runtime + page load, open New Task once.
2. Close/cancel without restarting anything.
3. Open New Task again with the same target.

**Pass:** first and second attempt have equivalent behavior. A first failure followed by an unexplained second success is a failure.

### C. Context isolation

Rapidly switch between two sessions/directories and return.

**Pass:** model/agent lists always belong to the visible session/directory. A late response from the previous destination must never replace the current picker.

### D. Create/start visibility

Create/start a TaskDesk task/run.

**Pass:** the resulting task/session appears quickly enough to feel synchronous; no long unexplained gap before it appears in the list.

Record create request completion time and first list-refresh where the new id appears.

### E. Open newly created task

Immediately open the created task/session.

**Pass:** transcript loads and model/agent picker is populated for that exact session and directory. No persistent yellow/error picker after the rest of the session is healthy.

### F. Second task state leakage

Without restarting the app, create a second task in a different directory/model when possible.

**Pass:** no model, agent, directory, selected session or loading state leaks from task 1 into task 2.

### G. Restart behavior

Restart only the browser page, then restart the runtime separately.

**Pass:** startup performs only necessary discovery and reaches a consistent state; no repeated expensive model/backend discovery loop.

## Single-backend order

Recommended order:

1. OpenCode — exercises the direct OpenCode path and model catalog heavily.
2. Codex — ACP path.
3. Claude — ACP path.
4. OMP — existing compatibility baseline.
5. PI — existing compatibility baseline.

Do not interpret one backend passing as proof that the others are safe.

## Multi-harness / machine-daemon gate

Only after single-backend testing:

1. start `npm start` without `--single`;
2. confirm detected harnesses;
3. connect one local browser profile to the daemon;
4. create/open work across at least two harnesses;
5. alternate quickly between them;
6. repeat the model/session context-isolation tests.

**Pass:** routing never sends model/session state to the wrong harness or stale machine context.

## Android gate

After the browser-local flow is stable, keep the same PC runtime running and connect the debug APK over LAN. Repeat the mandatory regression matrix. Any failure that exists only on Android should then be investigated as a mobile/network/Capacitor-specific problem rather than a TaskDesk core failure.

## Result recording

Record outcomes in issue #197 using:

```text
Backend:
Build/commit:
Test case:
PASS / FAIL:
Observed latency:
Network evidence:
Console evidence:
Notes:
```

No promotion toward `main` is justified by automated CI alone. The real-harness browser pass and the Android pass are explicit gates.
