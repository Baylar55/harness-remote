import {
  nativeSessionClaimTransport,
  type NativeSessionClaimTransport
} from "./native-session-claim"
import type { NativeSessionSurfaceTarget } from "./native-session-discovery"

export type NativeSessionContinuationResult = {
  writable: boolean
  reason?: string
}

export type NativeSessionContinuationApi = NativeSessionClaimTransport

/**
 * Confirm that Harness Remote can safely continue the exact same native Session before showing a
 * writable composer. OpenCode does not use the ACP single-writer session/load path, so an existing
 * OpenCode Session is directly resumable when it is idle. ACP-backed harnesses go through the
 * explicit native Session claim boundary whenever discovery says ownership cannot be proven.
 *
 * Do not use `external` as the ownership gate here. Lightweight ACP discovery may legitimately omit
 * that metadata, which is why NativeSessionSurfaceTarget carries `requiresExplicitClaim` separately.
 * A Codex Session still owned by a CLI/desktop writer therefore fails at the claim boundary and
 * remains observable rather than being stolen.
 */
export async function probeNativeSessionContinuation(
  target: NativeSessionSurfaceTarget,
  client: NativeSessionContinuationApi = nativeSessionClaimTransport
): Promise<NativeSessionContinuationResult> {
  if (target.backend === "opencode") return { writable: true }
  if (!target.requiresExplicitClaim) return { writable: true }

  try {
    await client.claimSession(target.config, target.directory, target.sessionID)
    return { writable: true }
  } catch (error) {
    return {
      writable: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
