/**
 * Which finished Sessions the user has not looked at yet.
 *
 * A Session turns "unseen" when it is ready and its native `updated` time has moved past the last
 * value the user was shown. That keeps every comparison in the owning machine's clock - the client
 * clock never meets a daemon timestamp - and it also catches a turn that finished while Harness
 * Remote was closed, which a working -> ready edge observed in the rail never could.
 *
 * Two guards keep the marker honest:
 * - A machine's baseline is the newest `updated` seen the first time that machine is listed, so
 *   installing this does not flag the whole history, and older pages loaded later stay quiet.
 * - Leaving a Session that was already ready starts a short grace window. The rail can still hold a
 *   record read before the final reply landed; a newer `updated` arriving inside the window is the
 *   turn the user just watched, and is adopted as seen instead of being reported back to them.
 */

export const NATIVE_SESSION_SEEN_STORAGE_KEY = "harness-remote.sessionSeen.v1"

/** Longer than the rail's 30s refresh, so the record read after leaving still falls inside it. */
export const SEEN_GRACE_MS = 120_000

/** Bounds the persisted map; the oldest entries are the ones least likely to be listed again. */
const MAX_SEEN_ENTRIES = 1_000

export type SeenEntry = {
  /** The Session's own `updated` value when the user last saw it. */
  updated: number
  /** Client time until which a newer `updated` is adopted as seen (see the module comment). */
  graceUntil?: number
}

export type NativeSessionSeenStore = {
  baselines: Record<string, number>
  seen: Record<string, SeenEntry>
}

export type UnseenCandidate = {
  key: string
  machineID: string
  updated: number
  ready: boolean
}

export function emptySeenStore(): NativeSessionSeenStore {
  return { baselines: {}, seen: {} }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function parseSeenStore(raw: string | null): NativeSessionSeenStore {
  if (!raw) return emptySeenStore()
  try {
    const parsed = JSON.parse(raw) as Partial<NativeSessionSeenStore>
    const store = emptySeenStore()
    for (const [machineID, value] of Object.entries(parsed.baselines ?? {})) {
      if (finiteNumber(value)) store.baselines[machineID] = value
    }
    for (const [key, entry] of Object.entries(parsed.seen ?? {})) {
      if (!entry || !finiteNumber(entry.updated)) continue
      store.seen[key] = finiteNumber(entry.graceUntil)
        ? { updated: entry.updated, graceUntil: entry.graceUntil }
        : { updated: entry.updated }
    }
    return store
  } catch {
    return emptySeenStore()
  }
}

export function serializeSeenStore(store: NativeSessionSeenStore): string {
  const entries = Object.entries(store.seen)
  const seen = entries.length > MAX_SEEN_ENTRIES
    ? Object.fromEntries(entries.sort(([, left], [, right]) => right.updated - left.updated).slice(0, MAX_SEEN_ENTRIES))
    : store.seen
  return JSON.stringify({ baselines: store.baselines, seen })
}

/** The first listing of a machine sets its baseline; nothing older than it is ever unseen. */
export function withMachineBaselines(
  store: NativeSessionSeenStore,
  candidates: readonly Pick<UnseenCandidate, "machineID" | "updated">[]
): NativeSessionSeenStore {
  const newest = new Map<string, number>()
  for (const { machineID, updated } of candidates) {
    if (machineID in store.baselines) continue
    newest.set(machineID, Math.max(newest.get(machineID) ?? 0, updated || 0))
  }
  if (!newest.size) return store
  return { ...store, baselines: { ...store.baselines, ...Object.fromEntries(newest) } }
}

/**
 * Record that the user saw this Session at `updated`. `settled` means it was not working when they
 * looked away, which is what opens the grace window.
 */
export function markSessionSeen(
  store: NativeSessionSeenStore,
  key: string,
  updated: number,
  now: number,
  settled: boolean
): NativeSessionSeenStore {
  const previous = store.seen[key]
  const next: SeenEntry = { updated: Math.max(previous?.updated ?? 0, updated || 0) }
  if (settled) next.graceUntil = now + SEEN_GRACE_MS
  if (previous && previous.updated === next.updated && previous.graceUntil === next.graceUntil) return store
  return { ...store, seen: { ...store.seen, [key]: next } }
}

/** Adopt, as already seen, any newer `updated` that arrived inside a grace window. */
export function adoptGraceUpdates(
  store: NativeSessionSeenStore,
  candidates: readonly Pick<UnseenCandidate, "key" | "updated">[],
  now: number
): NativeSessionSeenStore {
  let seen: Record<string, SeenEntry> | undefined
  for (const { key, updated } of candidates) {
    const entry = store.seen[key]
    if (!entry?.graceUntil || now >= entry.graceUntil || updated <= entry.updated) continue
    seen ??= { ...store.seen }
    seen[key] = { ...entry, updated }
  }
  return seen ? { ...store, seen } : store
}

export function sessionIsUnseen(store: NativeSessionSeenStore, candidate: UnseenCandidate, now: number): boolean {
  if (!candidate.ready || !candidate.updated) return false
  const entry = store.seen[candidate.key]
  if (entry) {
    if (entry.graceUntil && now < entry.graceUntil) return false
    return candidate.updated > entry.updated
  }
  const baseline = store.baselines[candidate.machineID]
  return baseline !== undefined && candidate.updated > baseline
}

export function loadSeenStore(): NativeSessionSeenStore {
  try {
    return parseSeenStore(window.localStorage.getItem(NATIVE_SESSION_SEEN_STORAGE_KEY))
  } catch {
    return emptySeenStore()
  }
}

export function saveSeenStore(store: NativeSessionSeenStore): void {
  try {
    window.localStorage.setItem(NATIVE_SESSION_SEEN_STORAGE_KEY, serializeSeenStore(store))
  } catch {
    // Private mode or a full quota: the marker then lasts for this page only, which is still correct.
  }
}
