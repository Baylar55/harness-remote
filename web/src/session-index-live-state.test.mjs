import assert from "node:assert/strict"
import test from "node:test"
import { discoverAgentNativeSessionPage } from "./native-session-discovery.ts"
import { taskDeskLiveEvent } from "./taskdesk-live-events.ts"
import {
  LIVE_SESSION_STATUS_GRACE_MS,
  liveSessionIndexError,
  liveSessionIndexStatus,
  noteSessionIndexLiveEvent,
  noteSessionIndexStreamConnected,
  sessionIndexInvalidationRevision,
  sessionIndexLifecycleEvent,
  subscribeSessionIndexInvalidation
} from "./session-index-live-state.ts"

const base = {
  backend: "opencode",
  host: "127.0.0.1",
  port: 4097,
  username: "harness",
  password: "secret"
}

const agent = {
  id: "opencode",
  label: "OpenCode",
  backend: "opencode",
  transport: "http",
  state: "available",
  capabilities: {
    sessions: true,
    abort: true,
    models: true,
    sessionRename: true,
    sessionDelete: true
  }
}

function session(status) {
  return {
    id: "ses_a",
    title: "A",
    directory: "/tmp/project",
    time: { created: 1, updated: 2 },
    ...(status ? { status: { type: status } } : {})
  }
}

test("OpenCode lifecycle edges invalidate the Session index while token chunks do not", () => {
  let notifications = 0
  let observedStatus
  const unsubscribe = subscribeSessionIndexInvalidation(() => {
    notifications += 1
    observedStatus = liveSessionIndexStatus(base, "ses_a")
  })
  const before = sessionIndexInvalidationRevision()

  noteSessionIndexLiveEvent(base, { type: "message.part.delta", sessionID: "ses_a" })
  assert.equal(sessionIndexInvalidationRevision(), before)
  assert.equal(notifications, 0, "streamed token chunks must not fan out into Session discovery")
  assert.equal(sessionIndexLifecycleEvent("message.part.delta"), false)

  noteSessionIndexLiveEvent(base, { type: "session.status", sessionID: "ses_a", status: "busy" })
  assert.equal(sessionIndexInvalidationRevision(), before + 1)
  assert.equal(notifications, 1, "a lifecycle edge must invalidate the Session rail directly")
  assert.deepEqual(observedStatus, { type: "busy" }, "the invalidation subscriber must observe the already-updated live status")
  assert.equal(sessionIndexLifecycleEvent("session.status"), true)
  unsubscribe()
})

test("OpenCode session.status normalization preserves the streamed status type", () => {
  const event = taskDeskLiveEvent(undefined, {
    type: "session.status",
    properties: { sessionID: "ses_a", status: { type: "idle" } }
  })
  assert.deepEqual(event, { type: "session.status", sessionID: "ses_a", status: "idle" })
})

test("OpenCode retry normalization preserves provider reason, attempt and next retry", () => {
  const event = taskDeskLiveEvent(undefined, {
    type: "session.status",
    properties: {
      sessionID: "ses_retry",
      status: {
        type: "retry",
        attempt: 2,
        message: "No available channel",
        next: 1_700_000_000_000
      }
    }
  })
  assert.deepEqual(event, {
    type: "session.status",
    sessionID: "ses_retry",
    status: "retry",
    statusMessage: "No available channel",
    statusAttempt: 2,
    statusNext: 1_700_000_000_000
  })

  noteSessionIndexLiveEvent(base, event, 1_000)
  assert.deepEqual(liveSessionIndexStatus(base, "ses_retry", 1_001), {
    type: "retry",
    attempt: 2,
    message: "No available channel",
    next: 1_700_000_000_000
  })
})

test("OpenCode session.error survives navigation until a real retry resumes", () => {
  const failure = taskDeskLiveEvent(undefined, {
    type: "session.error",
    properties: {
      sessionID: "ses_error",
      error: {
        name: "ApiError",
        data: { message: "No available channel" }
      }
    }
  })
  assert.deepEqual(failure, {
    type: "session.error",
    sessionID: "ses_error",
    errorMessage: "No available channel"
  })

  noteSessionIndexLiveEvent(base, failure, 2_000)
  assert.equal(liveSessionIndexError(base, "ses_error", 2_001), "No available channel")
  assert.deepEqual(liveSessionIndexStatus(base, "ses_error", 2_001), {
    type: "error",
    message: "No available channel"
  })

  const retry = taskDeskLiveEvent(undefined, {
    type: "session.status",
    properties: {
      sessionID: "ses_error",
      status: { type: "retry", attempt: 3, message: "Retrying provider route", next: 2_500 }
    }
  })
  noteSessionIndexLiveEvent(base, retry, 2_100)
  assert.equal(liveSessionIndexError(base, "ses_error", 2_101), undefined)
  assert.deepEqual(liveSessionIndexStatus(base, "ses_error", 2_101), {
    type: "retry",
    attempt: 3,
    message: "Retrying provider route",
    next: 2_500
  })
})

test("OpenCode nested provider error messages beat generic error names", () => {
  const event = taskDeskLiveEvent(undefined, {
    type: "session.error",
    properties: {
      sessionID: "ses_nested",
      error: {
        name: "UnknownError",
        data: { error: { message: "Provider routing exhausted" } }
      }
    }
  })
  assert.equal(event?.errorMessage, "Provider routing exhausted")
})

test("a fresh streamed idle edge beats a briefly stale busy status read", async () => {
  const now = Date.now()
  noteSessionIndexLiveEvent(base, { type: "session.status", sessionID: "ses_a", status: "idle" }, now)
  assert.deepEqual(liveSessionIndexStatus(base, "ses_a", now), { type: "idle" })

  const page = await discoverAgentNativeSessionPage(base, agent, undefined, {
    async listGlobalSessionPage() {
      return { sessions: [session()] }
    },
    async listSessions() {
      throw new Error("paged discovery should succeed")
    },
    async listStatuses() {
      return { ses_a: { type: "busy" } }
    }
  })
  assert.equal(page.records[0].status?.type, "idle")

  assert.equal(
    liveSessionIndexStatus(base, "ses_a", now + LIVE_SESSION_STATUS_GRACE_MS + 1),
    undefined,
    "stream authority must be bounded so a missed future event cannot pin the row forever"
  )
})

test("stream reconnect drops transient status and error authority and invalidates the Session index", () => {
  noteSessionIndexLiveEvent(base, { type: "session.status", sessionID: "ses_a", status: "idle" })
  noteSessionIndexLiveEvent(base, { type: "session.error", sessionID: "ses_a", errorMessage: "temporary failure" })
  const before = sessionIndexInvalidationRevision()
  assert.equal(liveSessionIndexStatus(base, "ses_a")?.type, "error")
  assert.equal(liveSessionIndexError(base, "ses_a"), "temporary failure")

  noteSessionIndexStreamConnected(base)
  assert.equal(liveSessionIndexStatus(base, "ses_a"), undefined)
  assert.equal(liveSessionIndexError(base, "ses_a"), undefined)
  assert.equal(sessionIndexInvalidationRevision(), before + 1)
})
