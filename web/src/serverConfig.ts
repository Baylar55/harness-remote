import type { ServerConfig } from "./types"

/**
 * Kept free of Capacitor imports so it can be unit tested directly: the rules here
 * decide whether the app is allowed to build a URL at all.
 */
export function baseUrl(config: ServerConfig): string {
  const host = config.host.trim()
  const schemeMatch = host.match(/^(https?):\/\//)
  const scheme = schemeMatch ? schemeMatch[1] : "http"
  const cleanHost = schemeMatch ? host.slice(schemeMatch[0].length) : host
  return `${scheme}://${cleanHost}:${config.port}`
}

/**
 * A host typed one character at a time passes through states such as `http:` and
 * `http://` that produce an unparseable base URL. Callers must check this before
 * building any URL, because a throw on the render path blanks the whole app and a
 * persisted invalid host reproduces that crash on every launch.
 */
/**
 * Browsers treat loopback as trustworthy even over plain http, so these hosts stay reachable
 * from an https page. Everything else does not.
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true
  if (hostname === "[::1]" || hostname === "::1") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

/**
 * The installable web app is served over https, and an https page may not talk to a plain
 * `http://` server unless that server is loopback: the browser refuses the request as mixed
 * content before it leaves, and `fetch` reports it as a bare "Failed to fetch" that says nothing
 * about the cause. That is exactly the phone-to-PC setup this app exists for, so the settings
 * panel has to name the problem instead of letting the user retype the address.
 *
 * Irrelevant in the native Android build, which is not a page and has no scheme to be mixed with.
 */
export function isMixedContentBlocked(config: ServerConfig, pageProtocol: string): boolean {
  if (pageProtocol !== "https:") return false
  try {
    const url = new URL(baseUrl(config))
    return url.protocol === "http:" && !isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

export function isValidServerConfig(config: ServerConfig): boolean {
  if (!config.host.trim() || !Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) return false
  try {
    const url = new URL(baseUrl(config))
    return Boolean(url.hostname)
  } catch {
    return false
  }
}
