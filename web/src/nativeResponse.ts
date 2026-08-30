/**
 * CapacitorHttp normally decodes JSON, but native engines can still hand a JSON response back as a
 * string depending on the server headers and platform. The browser path always calls
 * `response.json()`, so returning the string unchanged makes Android the only client that can turn a
 * session array into an iterable string — which is how a working OpenCode server passed the
 * connection test and then listed no sessions at all.
 *
 * Kept free of Capacitor imports so the rule can be exercised directly: what has to hold is that a
 * JSON-looking string is decoded and everything else — an already-parsed body, a plain-text error,
 * a malformed payload — comes back untouched.
 */
export function normalizeNativeResponseData(data: unknown): unknown {
  if (typeof data !== "string") return data
  const trimmed = data.trim()
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return data
  try {
    return JSON.parse(trimmed)
  } catch {
    return data
  }
}
