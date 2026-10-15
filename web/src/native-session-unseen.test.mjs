import assert from "node:assert/strict"
import test from "node:test"
import {
  SEEN_GRACE_MS,
  adoptGraceUpdates,
  emptySeenStore,
  markSessionSeen,
  parseSeenStore,
  serializeSeenStore,
  sessionIsUnseen,
  withMachineBaselines
} from "./native-session-unseen.ts"

const candidate = (overrides = {}) => ({ key: "m1:s1", machineID: "m1", updated: 1_000, ready: true, ...overrides })

test("the first listing of a machine is the baseline, so existing history is never flagged", () => {
  const store = withMachineBaselines(emptySeenStore(), [candidate(), candidate({ key: "m1:s2", updated: 900 })])
  assert.equal(store.baselines.m1, 1_000)
  assert.equal(sessionIsUnseen(store, candidate(), 0), false)
  // An older page loaded later is older than the baseline and stays quiet.
  assert.equal(sessionIsUnseen(store, candidate({ key: "m1:old", updated: 500 }), 0), false)
  // A later listing does not move the baseline forward.
  assert.equal(withMachineBaselines(store, [candidate({ updated: 5_000 })]).baselines.m1, 1_000)
})

test("a Session that finishes after the baseline is unseen until it is opened", () => {
  let store = withMachineBaselines(emptySeenStore(), [candidate()])
  const finished = candidate({ updated: 2_000 })
  assert.equal(sessionIsUnseen(store, finished, 0), true)
  store = markSessionSeen(store, finished.key, finished.updated, 0, false)
  assert.equal(sessionIsUnseen(store, finished, 0), false)
  // The next finished turn is news again.
  assert.equal(sessionIsUnseen(store, candidate({ updated: 3_000 }), 0), true)
})

test("only a ready Session is unseen; working and input requests keep their own state", () => {
  const store = withMachineBaselines(emptySeenStore(), [candidate()])
  assert.equal(sessionIsUnseen(store, candidate({ updated: 2_000, ready: false }), 0), false)
  assert.equal(sessionIsUnseen(store, candidate({ updated: 0 }), 0), false)
})

test("a machine without a baseline yet flags nothing", () => {
  assert.equal(sessionIsUnseen(emptySeenStore(), candidate({ updated: 9_999 }), 0), false)
})

test("leaving a ready Session adopts the reply the rail had not re-read yet", () => {
  let store = withMachineBaselines(emptySeenStore(), [candidate()])
  store = markSessionSeen(store, "m1:s1", 1_000, 10_000, true)
  // The rail's next read carries the final reply the user just watched.
  const reread = [candidate({ updated: 1_500 })]
  assert.equal(sessionIsUnseen(store, reread[0], 10_001), false)
  store = adoptGraceUpdates(store, reread, 10_001)
  assert.equal(store.seen["m1:s1"].updated, 1_500)
  // Once the window closes, only a genuinely newer turn is reported.
  const later = 10_000 + SEEN_GRACE_MS + 1
  assert.equal(sessionIsUnseen(store, reread[0], later), false)
  assert.equal(sessionIsUnseen(store, candidate({ updated: 2_000 }), later), true)
})

test("leaving a working Session opens no grace window, so its finish is reported", () => {
  let store = withMachineBaselines(emptySeenStore(), [candidate()])
  store = markSessionSeen(store, "m1:s1", 1_000, 10_000, false)
  assert.equal(sessionIsUnseen(store, candidate({ updated: 1_500 }), 10_001), true)
})

test("the persisted store survives a round trip and rejects malformed data", () => {
  let store = withMachineBaselines(emptySeenStore(), [candidate()])
  store = markSessionSeen(store, "m1:s1", 1_000, 5, true)
  assert.deepEqual(parseSeenStore(serializeSeenStore(store)), store)
  assert.deepEqual(parseSeenStore("{not json"), emptySeenStore())
  assert.deepEqual(parseSeenStore(JSON.stringify({ baselines: { m1: "x" }, seen: { a: { updated: null } } })), emptySeenStore())
})
