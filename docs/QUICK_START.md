# Harness Remote quick start

Harness Remote has two parts: a launcher on the machine where your repositories and coding agents
live, and a client you open from web, desktop or Android. The launcher runs the work; the client
lets you see and continue the native Sessions it exposes.

## Upgrading from Harness Remote 2.x

Harness Remote 3 changes the normal startup contract. HR2 commonly connected the client directly to one OpenCode server or one standalone ACP bridge per harness. HR3 is machine-first: the client expects a Harness **Machine** endpoint and discovers Projects, harnesses and native Sessions through it.

- Existing standalone ACP bridge commands such as `npx --yes ./bridge --backend omp|pi|claude|codex ...` are still supported as compatibility paths. They can expose native Sessions, but they do not provide the complete HR3 Project catalog/new-Session workflow.
- A direct `opencode serve` process from an HR2 setup is not a Harness Machine endpoint and cannot be added under **Machines** in HR3.
- HR2 saved server profiles are kept in storage for legacy code paths, but they are not automatically converted into HR3 `workspaceMachines`. After upgrading, add the machine again in **Machines → Add machine**.
- For the full HR3 experience, stop the old per-harness public endpoints and use the launcher or machine daemon described below. Legacy single-backend startup is intended for compatibility, not as the preferred HR3 onboarding path.

## Start a machine and open the client

Install Node.js 20+ and at least one supported coding-agent CLI on the machine with your code, then
start Harness Remote:

```bash
npx github:giuliastro/harness-remote \
  --host 0.0.0.0 \
  --port 4097 \
  --username harness \
  --password "use-a-long-unique-password" \
  --root "$HOME/Software" \
  --cors http://localhost:5173
```

`--root` is the directory boundary used when choosing Projects. When the HR3 machine-daemon path is
selected, startup prints one compact QR code for the preferred reachable machine endpoint. On
Android, scan the QR and Harness Remote imports the machine automatically. The QR contains a
256-bit one-time token valid for five minutes, **not** the daemon password, and that token can be
claimed only once.

The terminal intentionally does **not** dump the raw `harnessremote://` pairing URI, token or every
alternate network-interface address. If QR rendering is unavailable, use **Machines → Add machine**
with the single machine address, username and password already printed in the connection summary.
Pairing is currently a machine-daemon HR3 feature; legacy single-backend bridges keep their manual
connection flow.

To use the web/PWA frontend from a checkout:

```bash
cd harness-remote/web
npm ci
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`, then choose **Machines** > **Add
machine** and enter the machine address, username and password from the launcher. The `--cors` value
above permits that exact browser origin. The backend launcher deliberately does not print a browser
URL, because it cannot guarantee that a separate web frontend is running there.

For the hosted client, start the machine with:

```bash
harness-remote --cors https://giuliastro.github.io
```

Then open `https://giuliastro.github.io/harness-remote/` yourself in a browser. The launcher only
configures the allowed CORS origin; it does not present that address as a backend-owned web page.

Desktop and Android clients use the same machine address and credentials. Android can use the
scan-first pairing flow above; manual **Machines → Add machine** remains available on every client.

From a local repository checkout, the equivalent launcher command is:

```bash
npm start -- \
  --host 0.0.0.0 \
  --port 4097 \
  --username harness \
  --password "use-a-long-unique-password" \
  --root "$HOME/Software" \
  --cors http://localhost:5173
```

Run `npm install` once at the repository root if you want the checkout to render the terminal QR;
without that optional presentation dependency startup still succeeds and the printed machine address
and credentials remain the manual fallback.

When installed as a repository/package binary, the command is `harness-remote`. The root package
remains private: the GitHub/repository launch path is intentional and does not imply that an npm
package has been published.

## What the one command does

The launcher inspects `PATH` without executing discovered agent binaries and chooses the least-friction compatible runtime:

- with exactly one supported CLI, it preserves the existing single-backend startup path;
- with multiple supported CLIs and at least one ACP-backed agent, it starts the machine daemon automatically;
- the daemon exposes every detected ACP-backed agent through the same machine endpoint and selects one of them internally for legacy/unprefixed routing;
- managed OpenCode is included when OpenCode is installed and starts lazily on first use;
- `--backend <name>` selects the internal ACP default on a multi-agent machine;
- `--single --backend <name>` explicitly opts out of the daemon and forces the legacy single-backend path;
- if managed OpenCode is included, the launcher chooses a free loopback port automatically instead of assuming 4096 is unused;
- credentials are generated automatically and kept out of child-process argv;
- the HR3 machine daemon creates a 256-bit in-memory one-time pairing grant with a five-minute TTL;
- startup renders one QR for the preferred reachable endpoint when the terminal QR renderer is installed and never prints the raw pairing deep link;
- one non-clickable machine address, credentials and a plain harness list are printed once by the launcher;
- launcher-owned daemon/bridge children finish with a concise ready line instead of repeating endpoint, machine ID and harness details.

The supported CLI names are `omp`, `pi`, `claude`, `codex`, and `opencode`.

For example, on a workstation with Codex, Claude Code and OpenCode installed, the plain command:

```bash
harness-remote
```

starts one machine daemon instead of failing and asking you to choose a backend. The launcher reports the CLIs it detected, selects an internal ACP default for compatibility routing, finds a free loopback port for managed OpenCode, and exposes the machine through one authenticated daemon connection.

The current automatic multi-host shape is:

```text
Harness daemon :4097
  ├── Codex / Claude / OMP / PI — every detected ACP harness
  └── OpenCode, when installed — managed loopback host
```

The daemon registers the detected harnesses independently. Internal routing defaults do not hide or demote any harness in the client, and the normal startup list intentionally presents them without lifecycle or priority labels.

## Choose the daemon default or force one backend

On a multi-agent machine, choose the daemon's ACP default with:

```bash
harness-remote --backend codex --root ~/dev
```

To deliberately use the old single-agent runtime instead:

```bash
harness-remote --single --backend codex --root ~/dev
```

For loopback-only single-agent use:

```bash
harness-remote --single --backend omp --host 127.0.0.1
```

For a fixed LAN port and your own credentials:

```bash
harness-remote \
  --backend claude \
  --port 4900 \
  --username harness \
  --password 'choose-a-strong-password'
```

If OpenCode is present on a multi-agent machine, an existing process already using `127.0.0.1:4096` does not break startup: Harness scans forward for a free managed OpenCode port and passes it to the daemon. You can still choose one explicitly with `--opencode-port`.

## OpenCode

When OpenCode is the only selected backend, Harness Remote starts `opencode serve` itself, passes credentials through `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`, verifies the authenticated health endpoint, prints the launcher-owned connection summary, and supervises the child process until shutdown.

```bash
harness-remote --backend opencode
```

When the automatic machine daemon path is selected, OpenCode instead stays on its managed loopback listener and the client reaches it through the daemon's agent-scoped proxy. The phone/web/desktop client therefore does not need direct access to the internal OpenCode port.

## Machine daemon

The daemon can still be started explicitly when you want advanced options:

```bash
npm run daemon -- --backend codex --host 127.0.0.1
```

or:

```bash
harness-remote-daemon --backend codex --host 127.0.0.1
```

Direct advanced daemon/bridge invocation keeps its diagnostic startup information. The concise output ownership described above applies when the normal `harness-remote` launcher owns the child runtime.

`GET /v1/machine` and `GET /global/machine` expose the shared machine registry and stable machine identity. Host lifecycle is isolated: an unavailable managed host does not make the machine disappear.

Agent-scoped requests share the daemon connection:

```text
/v1/agents/codex/session
/v1/agents/codex/global/event
/v1/agents/opencode/session
/v1/agents/opencode/global/event
```

The selected internal ACP default is routed through the normalized bridge API. Managed OpenCode requests are streamed through the daemon to the loopback process; external credentials are authenticated at the daemon boundary and replaced with the managed host credentials for the internal request. Legacy unprefixed routes remain available during migration.

Managed OpenCode binds to `127.0.0.1` by default even when the daemon binds to `0.0.0.0`. Wider exposure is explicit:

```bash
harness-remote-daemon --backend codex --opencode-host 0.0.0.0
```

Useful daemon options:

```bash
harness-remote-daemon --backend claude --opencode-port 4901
harness-remote-daemon --backend codex --opencode-command /custom/opencode
harness-remote-daemon --backend codex --opencode-host 127.0.0.2
harness-remote-daemon --backend omp --no-opencode
```

For non-loopback daemon binding, the existing security rule still applies: username and password are required. The managed OpenCode listener remains loopback-only unless `--opencode-host` is supplied explicitly.

## Advanced/manual setup

The existing backend-specific bridge commands remain supported. Use them when you need custom adapter commands, unusual networking, browser CORS configuration, or other advanced settings documented in `REFERENCE.md`.
