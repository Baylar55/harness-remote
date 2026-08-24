import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import type { MachineAgentHost } from "../types"

type Props = {
  source: NativeSessionSurfaceTarget
  agents: MachineAgentHost[]
  onOpen: (target: NativeSessionSurfaceTarget) => void
}

/**
 * Cross-agent handoff is intentionally disabled while single native Session parity is being proven.
 * Keeping this component as a no-op preserves the surrounding Session workspace API without touching
 * the handoff protocol or creating a second timeline during the v3-first stabilization phase.
 */
export function NativeSessionHandoffControl(_props: Props) {
  return null
}
