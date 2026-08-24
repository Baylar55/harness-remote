import { api } from "./api"
import type { ServerConfig } from "./types"

export type NativeSessionClaimTransport = {
  claimSession(config: ServerConfig, directory: string, sessionID: string): Promise<void>
}

/**
 * Compatibility boundary for taking over the writer of an existing native ACP Session.
 *
 * The current bridge does not expose a dedicated claim endpoint yet. Its already-hardened way to
 * force the exact Session through ACP `session/load` is the session-scoped config/providers request
 * used by model discovery. Keep that transport detail here, away from Session-first product logic:
 * callers ask to claim a Session, not to list models. When the bridge grows a first-class claim
 * route, only this adapter needs to change and the UI/continuation state machine stays untouched.
 *
 * This operation must never create a Session, Task, Conversation or Run. A native writer lock
 * rejection is propagated to the caller so the Session remains observe-only.
 */
export const nativeSessionClaimTransport: NativeSessionClaimTransport = {
  async claimSession(config, directory, sessionID) {
    await api.listModels(config, directory, sessionID)
  }
}
