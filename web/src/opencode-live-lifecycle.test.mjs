import assert from "node:assert/strict"
import test from "node:test"

import { taskDeskLiveEvent } from "./taskdesk-live-events.ts"
import {
  liveSessionIndexError,
  liveSessionIndexStatus,
  noteSessionIndexLiveEvent
} from "./session-index-live-state.ts"

const config = {
  backend: "opencode",
  host: "127.0.0.1",
  port: 4097,
  username: "harness"
}

function openCodeEvent(type, properties) {
  return { type, properties }
}

test("OpenCode retry lifecycle preserves the provider reason and retry metadata", () => {
  const event = taskDeskLiveEvent(undefined, openCodeEvent("session.status", {
    sessionID: "ses-retry",
    status: {
      type: "retry",
      attempt: 2,
      message: "No available channel",
      next: 1_700_000_000_000
    }
  }))

  assert.deepEqual(event, {
    type: "session.status",
    sessionID: "ses-retry",
    status: "retry",
    statusMessage: "No available channel",
    statusAttempt: 2,
    statusNext: 1_700_000_000_000
  })

  noteSessionIndexLiveEvent(config, event, 1_000)
  assert.deepEqual(liveSessionIndexStatus(config, "ses-retry", 1_001), {
    type: "retry",
    attempt: 2,
    message: "No available channel",
    next: 1_700_000_000_000
  })
})

test("OpenCode session.error survives navigation until a real retry resumes", () => {
  const failure = taskDeskLiveEvent(undefined, openCodeEvent("session.error", {
    sessionID: "ses-error",
    error: {
      name: "ApiError",
      data: { message: "No available channel" }
    }
  }))

  assert.deepEqual(failure, {
    type: "session.error",
    sessionID: "ses-error",
    errorMessage: "No available channel"
  })

  noteSessionIndexLiveEvent(config, failure, 2_000)
  assert.equal(liveSessionIndexError(config, "ses-error", 2_001), "No available channel")
  assert.deepEqual(liveSessionIndexStatus(config, "ses-error", 2_001), {
    type: "error",
    message: "No available channel"
  })

  const retry = taskDeskLiveEvent(undefined, openCodeEvent("session.status", {
    sessionID: "ses-error",
    status: { type: "retry", attempt: 3, message: "Retrying provider route", next: 2_500 }
  }))
  noteSessionIndexLiveEvent(config, retry, 2_100)

  assert.equal(liveSessionIndexError(config, "ses-error", 2_101), undefined)
  assert.deepEqual(liveSessionIndexStatus(config, "ses-error", 2_101), {
    type: "retry",
    attempt: 3,
    message: "Retrying provider route",
    next: 2_500
  })
})

test("OpenCode nested provider error messages are preferred over generic error names", () => {
  const event = taskDeskLiveEvent(undefined, openCodeEvent("session.error", {
    sessionID: "ses-nested",
    error: {
      name: "UnknownError",
      data: { error: { message: "Provider routing exhausted" } }
    }
  }))
  assert.equal(event?.errorMessage, "Provider routing exhausted")
})
