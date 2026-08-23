import assert from "node:assert/strict"
import test from "node:test"
import { fingerprint, mergeRecords, reuseList } from "./workspace-runtime-merge.ts"

const conversation = (id, updatedAt, extra = {}) => ({ id, updatedAt, status: "completed", ...extra })

test("an unchanged poll keeps every identity so downstream memos can bail out", () => {
  const previous = [conversation("a", "2026-08-23T10:00:00Z"), conversation("b", "2026-08-23T09:00:00Z")]
  const polled = [conversation("a", "2026-08-23T10:00:00Z"), conversation("b", "2026-08-23T09:00:00Z")]
  const merged = mergeRecords(previous, polled)
  assert.equal(merged, previous)
})

test("two empty lists do not churn identity", () => {
  const previous = []
  assert.equal(mergeRecords(previous, []), previous)
  assert.equal(reuseList(previous, []), previous)
})

test("a real change is taken, and only the changed record loses identity", () => {
  const previous = [conversation("a", "2026-08-23T10:00:00Z"), conversation("b", "2026-08-23T09:00:00Z")]
  const polled = [conversation("a", "2026-08-23T10:00:00Z"), conversation("b", "2026-08-23T11:00:00Z", { status: "running" })]
  const merged = mergeRecords(previous, polled)
  assert.notEqual(merged, previous)
  assert.equal(merged[0], previous[0])
  assert.equal(merged[1], polled[1])
})

test("a slow list response cannot move a Conversation backwards", () => {
  // The open detail view reconciles far more often than the workspace poll. A `listTasks` response
  // that started before that reconcile must not resurrect the older Conversation.
  const reconciled = conversation("a", "2026-08-23T10:00:05Z", { status: "running" })
  const stale = conversation("a", "2026-08-23T10:00:00Z", { status: "completed" })
  const merged = mergeRecords([reconciled], [stale])
  assert.equal(merged[0], reconciled)
})

test("a newer server record always wins", () => {
  const known = conversation("a", "2026-08-23T10:00:00Z", { status: "running" })
  const fresher = conversation("a", "2026-08-23T10:00:09Z", { status: "completed" })
  assert.equal(mergeRecords([known], [fresher])[0], fresher)
})

test("new and removed conversations are honoured", () => {
  const previous = [conversation("a", "2026-08-23T10:00:00Z")]
  const added = mergeRecords(previous, [conversation("b", "2026-08-23T10:01:00Z"), previous[0]])
  assert.equal(added.length, 2)
  assert.equal(added[1], previous[0])
  assert.deepEqual(mergeRecords(previous, []), [])
})

test("reuseList keeps identity for structurally equal lists only", () => {
  const previous = [{ id: "one", label: "OpenCode" }]
  assert.equal(reuseList(previous, [{ id: "one", label: "OpenCode" }]), previous)
  const changed = [{ id: "one", label: "OpenCode 2" }]
  assert.equal(reuseList(previous, changed), changed)
})

test("fingerprint is cached per object and handles nullish snapshots", () => {
  const value = { a: 1 }
  assert.equal(fingerprint(value), fingerprint(value))
  assert.equal(fingerprint(null), "null")
  assert.equal(fingerprint(undefined), "undefined")
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }))
})
