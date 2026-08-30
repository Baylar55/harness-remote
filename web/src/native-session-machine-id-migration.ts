const MACHINE_SCOPED_PREFIXES = [
  "harness-remote.native-session-prompt.v1:",
  "harness-remote.native-session-command.v1:",
  "harness-remote.native-session-handoff.v1:",
  "harness-remote.native-session-handoff-context.v1:",
  "harness-remote.native-session-route-continue.v1:"
]

const DRAFT_PREFIX = "harness-remote.taskdesk.draft.native-session-v3:"

function movePrefix(storage: Storage, prefix: string, legacyMachineID: string, canonicalMachineID: string): void {
  const legacyPrefix = `${prefix}${encodeURIComponent(legacyMachineID)}:`
  const canonicalPrefix = `${prefix}${encodeURIComponent(canonicalMachineID)}:`
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key))
  for (const key of keys) {
    if (!key.startsWith(legacyPrefix)) continue
    const value = storage.getItem(key)
    if (value === null) continue
    const destination = `${canonicalPrefix}${key.slice(legacyPrefix.length)}`
    const existing = storage.getItem(destination)
    if (existing === null) {
      storage.setItem(destination, value)
      storage.removeItem(key)
    } else if (existing === value) {
      storage.removeItem(key)
    }
  }
}

/**
 * The v3 checkpoint originally keyed native browser state by the saved WorkspaceMachine id. Native
 * Session identity now uses the daemon's canonical machine id. Migrate every mutation-recovery key
 * before a Session can be opened under that canonical identity, otherwise a draft can disappear and
 * an uncertain prompt can lose the clientRequestId that prevents duplicate delivery.
 */
export function migrateNativeSessionMachineStorage(
  legacyMachineID: string,
  canonicalMachineID: string,
  storage: Storage = localStorage
): void {
  if (!legacyMachineID || !canonicalMachineID || legacyMachineID === canonicalMachineID) return
  try {
    for (const prefix of MACHINE_SCOPED_PREFIXES) {
      movePrefix(storage, prefix, legacyMachineID, canonicalMachineID)
    }
    movePrefix(storage, DRAFT_PREFIX, legacyMachineID, canonicalMachineID)
  } catch {
    // Private mode or a full WebView storage area must not prevent machine discovery. Existing keys
    // are left untouched and the native mutation layers remain conservative on future sends.
  }
}
