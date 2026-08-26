export type TailRefreshWork = () => Promise<void>

/**
 * Serialize authoritative transcript-tail reads and retain one trailing read when events arrive
 * while a read is already in flight. The pending slot always keeps the newest work item, so a burst
 * of streamed chunks becomes at most one extra authoritative read instead of either overlapping
 * loads or silently dropping the final event.
 */
export function createCoalescedTailRefresh(): (work: TailRefreshWork) => Promise<void> {
  let pending: TailRefreshWork | null = null
  let drainPromise: Promise<void> | null = null

  return function refresh(work: TailRefreshWork): Promise<void> {
    pending = work
    if (!drainPromise) {
      drainPromise = (async () => {
        let firstFailure: unknown
        while (pending) {
          const next = pending
          pending = null
          try {
            await next()
          } catch (error) {
            if (firstFailure === undefined) firstFailure = error
          }
        }
        if (firstFailure !== undefined) throw firstFailure
      })().finally(() => {
        drainPromise = null
      })
    }
    return drainPromise
  }
}
