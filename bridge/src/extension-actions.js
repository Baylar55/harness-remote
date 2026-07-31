function commandNames(commands) {
  return new Set(commands.map((command) => command.name?.replace(/^\//, "").toLowerCase()).filter(Boolean))
}

export const OMP_EXTENSION_ACTION_PROVIDERS = [{
  id: "omp-undo-redo",
  requiredCommands: ["undo", "redo"],
  resetOnSessionChange: ["redo"],
  actions: [
    { id: "undo", command: "undo", enabledByDefault: true, onSuccess: { redo: true } },
    { id: "redo", command: "redo", enabledByDefault: false, onSuccess: { redo: false } }
  ]
}]

function availableProviders(providers, commands) {
  const names = commandNames(commands)
  return providers.filter((provider) => provider.requiredCommands.every((command) => names.has(command)))
}

export function listExtensionActions(providers, commands, state, busy = false) {
  return availableProviders(providers, commands).flatMap((provider) => provider.actions.map((action) => ({
    id: action.id,
    source: provider.id,
    enabled: !busy && (state.get(action.id) ?? action.enabledByDefault)
  })))
}

export function resolveExtensionAction(providers, commands, actionID) {
  for (const provider of availableProviders(providers, commands)) {
    const action = provider.actions.find((candidate) => candidate.id === actionID)
    if (action) return { provider, action }
  }
  return undefined
}

export function applyExtensionActionSuccess(state, action) {
  for (const [actionID, enabled] of Object.entries(action.onSuccess ?? {})) state.set(actionID, enabled)
}

export function resetExtensionActionState(providers, commands, state) {
  for (const provider of availableProviders(providers, commands)) {
    for (const actionID of provider.resetOnSessionChange ?? []) state.delete(actionID)
  }
}
