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

export function parseConfig(args, environment = process.env) {
  const config = {
    host: environment.OMP_BRIDGE_HOST ?? "127.0.0.1",
    port: parsePort(environment.OMP_BRIDGE_PORT ?? "4097"),
    username: environment.OMP_BRIDGE_USERNAME ?? "",
    password: environment.OMP_BRIDGE_PASSWORD ?? "",
    ompBin: environment.OMP_BRIDGE_OMP_BIN ?? "omp",
    roots: environment.OMP_BRIDGE_ROOT ? [environment.OMP_BRIDGE_ROOT] : [],
    logRequests: environment.OMP_BRIDGE_LOG_REQUESTS === "1"
  }

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    switch (option) {
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
      case "--omp-bin":
        config.ompBin = requireValue(args, index, option)
        index += 1
        break
      case "--root":
        config.roots.push(requireValue(args, index, option))
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
  return `Usage: harness-remote-omp [options]\n\nOptions:\n  --host <host>          Bind host (default: 127.0.0.1)\n  --port <port>          Bind port (default: 4097)\n  --username <username>  Enable HTTP Basic Auth\n  --password <password>  Enable HTTP Basic Auth\n  --omp-bin <path>       OMP executable (default: omp)\n  --root <path>          Allowed worktree root; repeatable\n  --log-requests         Log request method, path, and query\n  --help                 Show this help`
}
