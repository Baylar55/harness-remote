import {
  ACTIVE_BACKEND_STORAGE_KEY,
  ACTIVE_PROFILE_STORAGE_KEY,
  BACKEND_STORAGE_KEYS,
  LEGACY_STORAGE_KEY,
  SERVER_PROFILES_STORAGE_KEY
} from "./serverProfiles"
import { WORKSPACE_MACHINES_STORAGE_KEY } from "./workspaceMachines"

/**
 * Everything the crash-recovery reset must be able to clear; language and theme are deliberately
 * excluded.
 *
 * The 3.0 shell boots from `workspaceMachines`, not from the 2.x server profiles, so a list that
 * only held the legacy keys could not clear the configuration that was actually being loaded. A
 * machine entry that crashed the render therefore reproduced the crash on every launch and the
 * recovery button did nothing — on Android that is the unrecoverable black screen the ErrorBoundary
 * exists to prevent. The v3 layout keys are included for the same reason: they are read at mount,
 * they are cheap to lose, and a poisoned value must not be able to survive a reset.
 */
export const SERVER_STORAGE_KEYS = [
  WORKSPACE_MACHINES_STORAGE_KEY,
  "harness-remote.v3.workspace-collapsed",
  "harness-remote.v3.workspace-sections-collapsed",
  "harness-remote.v3.conversation-pane-width",
  "harness-remote.v3.conversation-drawer-open",
  LEGACY_STORAGE_KEY,
  ACTIVE_BACKEND_STORAGE_KEY,
  BACKEND_STORAGE_KEYS.opencode,
  BACKEND_STORAGE_KEYS.omp,
  BACKEND_STORAGE_KEYS.pi,
  BACKEND_STORAGE_KEYS.claude,
  BACKEND_STORAGE_KEYS.codex,
  "opencode.remote.model",
  "opencode.remote.agent",
  "opencode.remote.newSessionDirectory",
  SERVER_PROFILES_STORAGE_KEY,
  ACTIVE_PROFILE_STORAGE_KEY
]
