import { api } from "./api"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"

export type NativeSessionContinuationResult = {
  writable: boolean
  reason?: string
}

export type NativeSessionContinuationApi = Pick<typeof api, "listModels">

/**
 * Confirm that Harness Remote can safely continue the exact same native Session before showing a
 * writable composer. OpenCode does not use the ACP single-writer session/load path, so an existing
 * OpenCode Session is directly resumable when it is idle. ACP-backed harnesses are probed through
 * the existing session-scoped model request: on ACP this forces the already-hardened session/load
 * path without creating a Task, a Run or a replacement Session. A Codex Session still owned by a
 * CLI/desktop writer therefore fails here and remains observable rather than being stolen.
 */
export async function probeNativeSessionContinuation(
  target: NativeSessionSurfaceTarget,
  client: NativeSessionContinuationApi = api
): Promise<NativeSessionContinuationResult> {
  if (!target.external) return { writable: true }
  if (target.backend === "opencode") return { writable: true }

  try {
    await client.listModels(target.config, target.directory, target.sessionID)
    return { writable: true }
  } catch (error) {
    return {
      writable: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
