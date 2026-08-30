import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")

test("Session-first chat keeps live refresh with slow bounded reconciliation", () => {
  const controller = read("./components/work-thread-conversation.tsx")
  const liveRefresh = read("./taskdesk-session-live-refresh.ts")

  assert.match(controller, /ACTIVE_RECONCILE_MS = 5_000/)
  assert.match(controller, /IDLE_RECONCILE_MS = 30_000/)
  assert.match(controller, /startTaskDeskSessionLiveRefresh/)
  assert.match(controller, /createCoalescedTailRefresh/)
  assert.match(liveRefresh, /CapacitorApp\.addListener\("appStateChange"/)
  assert.match(liveRefresh, /document\.addEventListener\("visibilitychange"/)
})

test("Session list never fans out transcript reads for card previews", () => {
  const home = read("./components/native-session-home.tsx")
  assert.doesNotMatch(home, /loadMessagePage/)
  assert.doesNotMatch(home, /loadLatestMessage/)
  assert.match(home, /discoverMachineNativeSessions/)
})

test("Session detail keeps bounded paging and memoized transcript rendering", () => {
  const controller = read("./components/work-thread-conversation.tsx")
  const conversation = read("./components/taskdesk-conversation.tsx")

  assert.match(controller, /INITIAL_PAGE_SIZE = 200/)
  assert.match(controller, /OLDER_PAGE_SIZE = 500/)
  assert.match(controller, /prependOlderMessagePage/)
  assert.match(conversation, /const ConversationTranscript = memo/)
  assert.match(conversation, /function transcriptPropsEqual/)
  assert.match(conversation, /previous\.messages === next\.messages/)
})

test("ACP bridge retains lightweight Session indexing, cursor paging and diagnostics", () => {
  const source = read("../../bridge/src/server.js")
  const service = read("../../bridge/src/acp-service.js")

  assert.match(source, /const listVisibleSessionMetadata = async/)
  assert.match(source, /const MAX_MESSAGE_PAGE = 500/)
  assert.match(source, /service\.messagePage\(sessionID/)
  assert.match(source, /X-Next-Cursor/)
  assert.match(source, /X-Has-More/)
  assert.match(source, /url\.pathname === "\/v1\/diagnostics"/)
  assert.match(service, /#messages = new TranscriptCache/)
  assert.match(service, /async messagePage\(sessionID/)
})

test("mobile Session-first shell is native list plus detail, not the retired TaskDesk panes", () => {
  const shell = read("./components/standalone-universal-workspace.tsx")
  const home = read("./components/native-session-home.tsx")
  const navigation = read("./session-first-navigation.css")

  assert.match(shell, /<NativeSessionHome/)
  assert.match(shell, /<NativeSessionObserver/)
  assert.match(shell, /mobileDetailOpen/)
  assert.match(shell, /className="tdw-mobile-back"/)
  assert.match(home, /hr-native-machine-group/)
  assert.match(home, /hr-native-project-group/)
  assert.match(home, /hr-native-session-row/)
  assert.match(navigation, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
})

test("Android back unwinds Session-first surfaces before exiting", () => {
  const shell = read("./components/standalone-universal-workspace.tsx")
  assert.match(shell, /CapacitorApp\.addListener\("backButton"/)
  assert.match(shell, /if \(settingsOpen\)/)
  assert.match(shell, /if \(managerOpen\)/)
  assert.match(shell, /\.tdw-model-picker\.open/)
  assert.match(shell, /\.tdw-mobile-back/)
  assert.match(shell, /CapacitorApp\.exitApp\(\)/)
})

test("Session-first never repairs its own rendered tree from a MutationObserver", () => {
  const main = read("./main.tsx")
  const shell = read("./components/standalone-universal-workspace.tsx")
  const home = read("./components/native-session-home.tsx")
  assert.doesNotMatch(main, /MutationObserver/)
  assert.doesNotMatch(shell, /MutationObserver/)
  assert.doesNotMatch(home, /MutationObserver/)
})
