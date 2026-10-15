/**
 * Which finished Sessions the user has not opened yet.
 *
 * A Session is marked when the rail sees it go from working to ready, and stays marked until the
 * user opens it. Only that observed edge counts: comparing harness timestamps flagged old Sessions
 * whenever a harness moved its `updated` time without a new turn (opening a Session, or a listing
 * with no time at all), so the marker is deliberately in-memory and starts empty on every load.
 */

export type SessionRailState = "working" | "attention" | "stopped" | "ready"

/**
 * The marked Sessions after one rail update.
 *
 * `viewing` is the Session open on a visible page: it finishes in front of the user, so it is
 * never marked, and opening a marked Session clears it. A Session that leaves ready - a new turn,
 * an input request - drops its mark too, because its row then shows that state instead.
 */
export function nextFinishedKeys(
  finished: ReadonlySet<string>,
  previous: ReadonlyMap<string, SessionRailState>,
  current: ReadonlyMap<string, SessionRailState>,
  viewing?: string
): ReadonlySet<string> {
  const next = new Set<string>()
  for (const key of finished) {
    const state = current.get(key)
    // A Session missing from this update (an unloaded page, a filter) keeps its mark.
    if (key !== viewing && (state === undefined || state === "ready")) next.add(key)
  }
  for (const [key, state] of current) {
    if (state === "ready" && previous.get(key) === "working" && key !== viewing) next.add(key)
  }
  if (next.size === finished.size && [...next].every((key) => finished.has(key))) return finished
  return next
}
