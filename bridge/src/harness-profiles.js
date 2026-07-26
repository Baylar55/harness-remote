import { createOmpHistoryLoader } from "./omp-session-history.js"

const COMMON_CAPABILITIES = {
  sessions: true,
  prompt: true,
  abort: true,
  streaming: true,
  agents: false,
  diff: false,
  filesystemBrowser: true,
  questions: false,
  sessionRename: false,
  sessionDelete: false
}

export const HARNESS_PROFILES = {
  omp: {
    id: "omp",
    label: "Oh My Pi",
    command: "omp",
    args: ["acp"],
    permissionMode: "allow",
    historyLoader: createOmpHistoryLoader(),
    capabilities: {
      ...COMMON_CAPABILITIES,
      models: true,
      todos: true,
      commands: false
    }
  },
  pi: {
    id: "pi",
    label: "PI",
    // @automatalabs/pi-acp embeds PI through its published SDK and runs on Node.
    // @victor-software-house/pi-acp declares engines.bun and shells out to `bun`, which this
    // project deliberately does not depend on. The version is pinned because an unpinned
    // default failed with `notarget` when a release outran its own tarball in the registry.
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "@automatalabs/pi-acp@0.2.5"],
    permissionMode: "allow",
    capabilities: {
      ...COMMON_CAPABILITIES,
      models: true,
      todos: false,
      commands: true
    }
  }
}

export function harnessProfile(id) {
  const profile = HARNESS_PROFILES[id]
  if (!profile) throw new Error(`Unsupported backend: ${id}`)
  return profile
}
