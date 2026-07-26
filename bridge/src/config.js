const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

function requireValue(args, index, option) {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`)
  return value
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535")
  }
  return port
}

function parseArgumentList(value, fallback) {
  if (value === undefined) return [...fallback]
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("OMP_BRIDGE_ACP_ARGS must be a JSON array")
  }
  if (!Array.isArray(parsed) || parsed.some((argument) => typeof argument !== "string")) {
    throw new Error("OMP_BRIDGE_ACP_ARGS must be a JSON array of strings")
  }
  return parsed
}

function parseBackend(value) {
  if (value !== "omp" && value !== "pi") throw new Error("--backend must be omp or pi")
  return value
}

function defaultAcpCommand(backend) {
  return backend === "pi" ? (process.platform === "win32" ? "npx.cmd" : "npx") : "omp"
}

// @automatalabs/pi-acp embeds PI through its published SDK and runs on Node. The other
// widely referenced adapter, @victor-software-house/pi-acp, declares `engines.bun` and
// shells out to `bun`, which this project deliberately does not depend on.
//
// The version is pinned rather than floating on `latest`: an unpinned default failed here
// with `notarget` when an upstream release appeared in the registry index before its
// tarball was fetchable. Override with --acp-arg to track a newer adapter.
const PI_ADAPTER = "@automatalabs/pi-acp@0.2.5"

function defaultAcpArgs(backend) {
  return backend === "pi" ? ["-y", PI_ADAPTER] : ["acp"]
}


export function parseConfig(args, environment = process.env) {
  const backend = parseBackend(environment.OMP_BRIDGE_BACKEND ?? "omp")
  const config = {
    backend,
    host: environment.OMP_BRIDGE_HOST ?? "127.0.0.1",
    port: parsePort(environment.OMP_BRIDGE_PORT ?? "4097"),
    username: environment.OMP_BRIDGE_USERNAME ?? "",
    password: environment.OMP_BRIDGE_PASSWORD ?? "",
    acpCommand: environment.OMP_BRIDGE_ACP_COMMAND ?? defaultAcpCommand(backend),
    acpArgs: parseArgumentList(environment.OMP_BRIDGE_ACP_ARGS, defaultAcpArgs(backend)),
    roots: environment.OMP_BRIDGE_ROOT ? [environment.OMP_BRIDGE_ROOT] : [],
    corsOrigins: environment.OMP_BRIDGE_CORS ? [environment.OMP_BRIDGE_CORS] : [],
    logRequests: environment.OMP_BRIDGE_LOG_REQUESTS === "1"
  }
  let acpCommandOverridden = environment.OMP_BRIDGE_ACP_COMMAND !== undefined
  let acpArgsOverridden = environment.OMP_BRIDGE_ACP_ARGS !== undefined

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    switch (option) {
      case "--backend":
        config.backend = parseBackend(requireValue(args, index, option))
        if (!acpCommandOverridden) config.acpCommand = defaultAcpCommand(config.backend)
        if (!acpArgsOverridden) config.acpArgs = defaultAcpArgs(config.backend)
        index += 1
        break
      case "--host":
        config.host = requireValue(args, index, option)
        index += 1
        break
      case "--port":
        config.port = parsePort(requireValue(args, index, option))
        index += 1
        break
      case "--username":
        config.username = requireValue(args, index, option)
        index += 1
        break
      case "--password":
        config.password = requireValue(args, index, option)
        index += 1
        break
      case "--acp-command":
        config.acpCommand = requireValue(args, index, option)
        acpCommandOverridden = true
        index += 1
        break
      case "--acp-arg":
        if (!acpArgsOverridden) {
          config.acpArgs = []
          acpArgsOverridden = true
        }
        config.acpArgs.push(requireValue(args, index, option))
        index += 1
        break
      case "--root":
        config.roots.push(requireValue(args, index, option))
        index += 1
        break
      case "--cors":
        config.corsOrigins.push(requireValue(args, index, option))
        index += 1
        break
      case "--log-requests":
        config.logRequests = true
        break
      case "--help":
        config.help = true
        break
      default:
        throw new Error(`Unknown option: ${option}`)
    }
  }

  if (Boolean(config.username) !== Boolean(config.password)) {
    throw new Error("--username and --password must be supplied together")
  }
  if (!LOOPBACK_HOSTS.has(config.host) && !config.username) {
    throw new Error("A username and password are required when binding beyond loopback")
  }
  return config
}

export function usage() {
  return `Usage: harness-remote-bridge [options]\n\nOptions:\n  --backend <name>       ACP backend: omp or pi (default: omp)\n  --host <host>          Bind host (default: 127.0.0.1)\n  --port <port>          Bind port (default: 4097)\n  --username <username>  Enable HTTP Basic Auth\n  --password <password>  Enable HTTP Basic Auth\n  --acp-command <path>   ACP adapter command (default depends on backend)\n  --acp-arg <arg>        ACP adapter argument; repeatable\n  --root <path>          Allowed worktree root; repeatable\n  --cors <origin>        Allow browser requests from this exact origin; repeatable\n  --log-requests         Log request method, path, and query\n  --help                 Show this help`
}
