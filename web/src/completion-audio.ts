import type { SessionStatus } from "./types"

const COMPLETION_AUDIO_SUFFIX = "audio/staplebops-01.aac"
const WORKING_STATES = new Set(["busy", "retry", "waiting"])

type AudioLike = HTMLAudioElement

type ArmedCompletion = {
  sessionID: string
  sawWorking: boolean
}

let armed: ArmedCompletion | null = null
let deferredAudio: AudioLike | null = null
let installed = false
let nativePlay: ((this: HTMLMediaElement) => Promise<void>) | null = null

function isCompletionAudio(element: HTMLMediaElement): element is AudioLike {
  const source = element.currentSrc || (element instanceof HTMLAudioElement ? element.src : "")
  return source.includes(COMPLETION_AUDIO_SUFFIX)
}

function playDeferredCompletion(): void {
  const audio = deferredAudio
  deferredAudio = null
  if (!audio || !nativePlay) return
  try {
    audio.currentTime = 0
    void nativePlay.call(audio).catch(() => undefined)
  } catch {
    // Audio is best-effort. Completion state must never fail because playback was blocked.
  }
}

export function installCompletionAudioGuard(): void {
  if (installed || typeof HTMLMediaElement === "undefined") return
  installed = true
  nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function guardedCompletionPlay(this: HTMLMediaElement): Promise<void> {
    if (!isCompletionAudio(this)) return nativePlay!.call(this)
    // App.tsx currently asks for the sound when the first assistant fragment arrives. Keep the
    // request, but defer the actual playback until session/status confirms the run has finished.
    deferredAudio = this
    return Promise.resolve()
  }
}

export function armCompletionAudio(sessionID: string): void {
  armed = { sessionID, sawWorking: false }
  deferredAudio = null
}

export function cancelCompletionAudio(sessionID: string): void {
  if (armed?.sessionID !== sessionID) return
  armed = null
  deferredAudio = null
}

export function observeCompletionStatuses(statuses: Record<string, SessionStatus>): void {
  if (!armed) return
  const status = statuses[armed.sessionID]?.type ?? "idle"
  if (WORKING_STATES.has(status)) {
    armed.sawWorking = true
    return
  }

  // The normal case observes working -> idle. Very fast replies can finish between status polls;
  // in that case App.tsx's deferred playback request proves that an assistant reply actually
  // arrived, so an idle status is authoritative completion rather than a send-time false positive.
  if (armed.sawWorking || deferredAudio) {
    armed = null
    playDeferredCompletion()
  }
}

export function resetCompletionAudioForTests(): void {
  armed = null
  deferredAudio = null
}
