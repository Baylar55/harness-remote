function cleanText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function cleanRole(value, fallback = "continue") {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || fallback
}

function runStatus(run, taskStatus) {
  if (run?.finishedAt) {
    if (taskStatus === "failed" && run.id) return "failed"
    return "completed"
  }
  return taskStatus || "unknown"
}

export function summarizeTaskRun(run, taskStatus = "unknown") {
  if (!run || typeof run !== "object") return null
  const sequence = Number.isFinite(Number(run.sequence)) ? Number(run.sequence) : undefined
  const model = run.model && typeof run.model === "object"
    ? {
        providerID: cleanText(run.model.providerID),
        modelID: cleanText(run.model.modelID),
        ...(cleanText(run.model.variant) ? { variant: cleanText(run.model.variant) } : {})
      }
    : null
  return {
    ...(run.id ? { id: run.id } : {}),
    ...(sequence ? { sequence } : {}),
    agentId: cleanText(run.agentId),
    role: cleanRole(run.role, sequence === 1 ? "implement" : "continue"),
    ...(model?.providerID && model?.modelID ? { model } : {}),
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    status: runStatus(run, taskStatus),
    prompt: cleanText(run.prompt),
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(Number.isFinite(Number(run.contextRevision)) ? { contextRevision: Number(run.contextRevision) } : {})
  }
}

export function buildPersistedTaskContext(task, revision = task?.context?.revision ?? 0) {
  const runs = Array.isArray(task?.runs) ? task.runs : task?.run ? [task.run] : []
  const runSummaries = runs.map((run) => summarizeTaskRun(run, run?.id === task?.run?.id ? task?.status : run?.finishedAt ? "completed" : "unknown")).filter(Boolean)
  const latestRun = task?.run ? summarizeTaskRun(task.run, task.status) : null
  const errorMessage = cleanText(task?.error?.message)
  return {
    version: 1,
    revision: Math.max(0, Number(revision) || 0),
    taskId: task?.id || "",
    objective: cleanText(task?.prompt),
    currentState: cleanText(task?.status) || "draft",
    latestOutcome: latestRun
      ? {
          status: latestRun.status,
          agentId: latestRun.agentId,
          role: latestRun.role,
          ...(errorMessage ? { error: errorMessage } : {})
        }
      : null,
    runSummaries
  }
}

export function buildTaskContext(task, { workspace } = {}) {
  const persisted = task?.context && task.context.version === 1
    ? task.context
    : buildPersistedTaskContext(task)
  const changedFiles = Array.isArray(workspace?.changedFiles)
    ? workspace.changedFiles.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
    : []
  return {
    ...structuredClone(persisted),
    currentState: cleanText(task?.status) || persisted.currentState || "draft",
    latestRun: task?.run ? summarizeTaskRun(task.run, task.status) : null,
    changedFiles,
    workspace: {
      dirty: Boolean(workspace?.dirty),
      changeCount: Number(workspace?.changeCount) || changedFiles.length
    },
    verification: null,
    unresolved: []
  }
}

export function formatTaskHandoff(context, { targetAgentId, role, instruction }) {
  const lines = [
    "You are taking over an existing TaskDesk task.",
    "The context below was transferred by TaskDesk. It is not native conversational memory from another harness.",
    "",
    "TASK OBJECTIVE",
    context.objective || "(not recorded)",
    "",
    "CURRENT STATE",
    context.currentState || "unknown"
  ]

  const latest = context.latestRun || context.runSummaries?.at?.(-1)
  if (latest) {
    lines.push(
      "",
      "PREVIOUS STEP",
      `${latest.agentId || "unknown harness"} / ${latest.role || "continue"} / ${latest.status || "unknown"}`
    )
  }

  if (context.latestOutcome?.error) {
    lines.push("", "LATEST ERROR", context.latestOutcome.error)
  }

  if (context.changedFiles?.length) {
    lines.push("", "CHANGED FILES", ...context.changedFiles.map((file) => `- ${file}`))
  } else if (context.workspace?.changeCount) {
    lines.push("", "WORKSPACE CHANGES", `${context.workspace.changeCount} changed file(s) are present in the shared workspace.`)
  }

  if (context.runSummaries?.length) {
    lines.push("", "RECENT TASK STEPS")
    for (const run of context.runSummaries.slice(-6)) {
      lines.push(`- Run ${run.sequence || "?"}: ${run.agentId || "unknown"} / ${run.role || "continue"} / ${run.status || "unknown"}`)
    }
  }

  lines.push(
    "",
    "YOUR ROLE",
    cleanRole(role),
    "",
    "TARGET HARNESS",
    cleanText(targetAgentId) || "unknown",
    "",
    "USER INSTRUCTION",
    cleanText(instruction),
    "",
    "Continue from the shared workspace and the transferred Task Context. Inspect the current files before assuming previous work is correct."
  )

  return lines.join("\n")
}
