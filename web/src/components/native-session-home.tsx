import { useEffect, useMemo, useSyncExternalStore, type ComponentProps } from "react"
import {
  NativeSessionHome as NativeSessionHomeWithAttention,
  appendCursorPage,
  attentionInboxCounts,
  refreshCursorPage,
  sessionTreeRows
} from "./native-session-home-attention"
import { nativeSessionConfig } from "../native-session-discovery"
import {
  sessionIndexInvalidationRevision,
  subscribeSessionIndexInvalidation
} from "../session-index-live-state"
import { subscribeTaskDeskLiveEvents } from "../taskdesk-live-events"

export { appendCursorPage, attentionInboxCounts, refreshCursorPage, sessionTreeRows }

export type {
  AttentionInboxCounts,
  CursorPageState
} from "./native-session-home-attention"

type Props = ComponentProps<typeof NativeSessionHomeWithAttention>

/**
 * Session lifecycle is not part of `/v1/machine`, so a live edge must invalidate the Session read
 * directly rather than smuggling client-only state into the daemon snapshot. Cloning only the
 * source wrappers preserves the real machine payload while making the existing discovery effect
 * observe the lifecycle revision. Manual refreshToken semantics remain untouched.
 *
 * The rail also owns one persistent routed global event stream for each available OpenCode agent.
 * A daemon's unscoped browser stream can belong to its primary harness and therefore cannot safely
 * identify OpenCode lifecycle edges when another ACP is primary. Routing this OpenCode subscription
 * with the same `nativeSessionConfig` used by discovery keeps status/error authority isolated by
 * machine + agent without adding ACP streams, per-Session observers, polling, or waking a lazy
 * configured OpenCode host just because the rail is visible. The selected detail stream remains
 * presentation/transcript-only.
 */
export function NativeSessionHome(props: Props) {
  const liveRevision = useSyncExternalStore(
    subscribeSessionIndexInvalidation,
    sessionIndexInvalidationRevision,
    sessionIndexInvalidationRevision
  )
  const liveSources = useMemo(
    () => props.sources.map((source) => ({ ...source })),
    [props.sources, liveRevision]
  )

  const routedStreamSignature = props.sources.map(({ machine, snapshot }) => [
    machine.id,
    machine.config.host,
    machine.config.port,
    machine.config.username,
    machine.config.password,
    snapshot?.machine.id || "",
    snapshot?.agents
      .filter((agent) => agent.backend === "opencode" && agent.state === "available" && agent.capabilities?.sessions !== false)
      .map((agent) => `${agent.id}:${agent.backend}:${agent.transport}:${agent.state}`)
      .join(",") || ""
  ].join("\u0000")).join("\u0001")

  useEffect(() => {
    const subscriptions = props.sources.flatMap(({ machine, snapshot }) => {
      if (!snapshot) return []
      return snapshot.agents
        .filter((agent) => agent.backend === "opencode" && agent.state === "available" && agent.capabilities?.sessions !== false)
        .map((agent) => subscribeTaskDeskLiveEvents({
          config: nativeSessionConfig(machine.config, agent),
          trackSessionIndex: true,
          // Lifecycle normalization/cache happens inside the shared transport. The rail discovery
          // reacts through useSyncExternalStore above; it does not need another per-event callback.
          onEvent: () => undefined
        }))
    })
    return () => {
      for (const subscription of subscriptions) subscription.close()
    }
    // Endpoint + OpenCode routing semantics, not source array identity: machine refreshes rebuild
    // wrappers even when routing is unchanged. Reopening the SSE stream on each render loses edges.
  }, [routedStreamSignature])

  return <NativeSessionHomeWithAttention {...props} sources={liveSources} />
}
