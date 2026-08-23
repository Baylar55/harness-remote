function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))]
}

export function acpHarnessCapabilityContract(profile) {
  const variantConfigIDs = uniqueStrings(profile?.modelVariantConfigIDs)
  return {
    version: 1,
    protocol: "acp",
    transport: {
      control: "stdio-json-rpc",
      events: "acp-session-update"
    },
    toolCalls: {
      representation: "acp-session-update"
    },
    models: {
      source: "acp-config-options",
      // The release candidate deliberately keeps the last real-machine-validated ownership model:
      // one daemon-owned technical catalog Session per harness adapter lifetime. Project-scoped ACP
      // discovery was audited in isolation but regressed PI, Codex and Claude on Windows, so it is
      // not part of the promotion candidate until it has its own real-harness proof.
      cacheScope: "machine",
      variants: variantConfigIDs.length ? "runtime-advertised-config-options" : "runtime-advertised-only",
      variantConfigIDs
    },
    lifecycle: {
      sessionAuthority: "native-harness",
      create: "native-session",
      resume: "native-session-when-supported",
      stop: "native-abort",
      reconnect: "daemon-reconciliation"
    }
  }
}

export function openCodeCapabilityContract() {
  return {
    version: 1,
    protocol: "opencode-http",
    transport: {
      control: "http-json",
      events: "sse-daemon-fanout"
    },
    toolCalls: {
      representation: "opencode-message-parts"
    },
    models: {
      source: "runtime-provider-api",
      cacheScope: "machine",
      variants: "provider-advertised",
      variantConfigIDs: []
    },
    lifecycle: {
      sessionAuthority: "native-harness",
      create: "native-session",
      resume: "native-session-id",
      stop: "native-abort",
      reconnect: "daemon-sse-fanout-and-reconciliation"
    }
  }
}
