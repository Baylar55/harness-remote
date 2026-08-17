import { useEffect, useMemo, useRef, useState } from "react"
import { CloseIcon, FolderIcon, LoadingIcon, PlayIcon, ServerIcon } from "../Icons"
import { createCatalogRequestGuard } from "../catalog-request-guard"
import { loadActiveServerProfile, loadServerProfiles } from "../serverProfiles"
import { discoverMachineConnection, selectableMachineAgents } from "../taskMachineClient"
import { taskClient, type MachineProject, type MachineTask } from "../taskClient"
import type { Translator } from "../i18n"
import type { MachineSnapshot, ModelOption, ServerConfig } from "../types"

const TASK_FALLBACKS: Record<string, string> = {
  "task.new": "New Task",
  "task.start": "Start Task",
  "task.starting": "Starting…",
  "task.subtitle": "Start agent work on {machine}.",
  "task.project": "Project",
  "task.model": "Model",
  "task.modelDefault": "Agent default",
  "task.label": "Task",
  "task.agent": "Agent",
  "task.machine": "Machine",
  "task.loading": "Loading machine projects and agents…",
  "task.modelLoading": "Loading models…",
  "task.promptPlaceholder": "Describe the work the agent should complete…",
  "task.isolatedWorktree": "Use a new isolated Git worktree",
  "task.nonGit": "This project is not a Git repository, so the task will run in the project directory.",
  "task.requiresDaemon": "Task launch requires the Harness machine daemon.",
  "task.noProjects": "This machine has no known projects. Configure a project root on the daemon before starting a task.",
  "task.agentUnavailable": "The selected agent is unavailable on this machine."
}

function taskText(t: Translator, key: string, params: Record<string, string | number> = {}): string {
  const translated = t(key, params)
  if (translated !== key) return translated
  const template = TASK_FALLBACKS[key] ?? key
  return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template)
}

function preferredAgentID(machine: MachineSnapshot, config: ServerConfig): string {
  const agents = selectableMachineAgents(machine)
  return agents.find((agent) => config.agentId ? agent.id === config.agentId : agent.backend === config.backend)?.id
    ?? agents[0]?.id
    ?? ""
}

/**
 * Task-first launcher restored from PR #172, kept as its own component rather than folded back into
 * App.tsx. It resolves the machine daemon independently from the saved session endpoint and fetches
 * models at machine/agent level, so a new task does not depend on an existing session catalog.
 *
 * This integration-only surface intentionally allows switching among the agents exposed by the
 * machine daemon. Model refreshes use the dedicated read-side request guard so a slow response from
 * the previously selected agent can never replace the current agent's catalog.
 *
 * The archived i18n table predates the unmerged #172 TaskDesk labels. English fallbacks live here
 * rather than rewriting the global translation file; localized strings can be restored separately
 * if/when New Task is intentionally exposed in the normal application.
 */
export function TaskLaunchDialog({ t, onClose, onLaunched }: {
  t: Translator
  onClose: () => void
  onLaunched: (task: MachineTask) => void
}) {
  const profile = useMemo(() => loadActiveServerProfile(loadServerProfiles()), [])
  const config: ServerConfig = profile.config
  const modelGuardRef = useRef(createCatalogRequestGuard())
  const [taskConfig, setTaskConfig] = useState<ServerConfig | null>(null)
  const [machine, setMachine] = useState<MachineSnapshot | null>(null)
  const [projects, setProjects] = useState<MachineProject[]>([])
  const [projectId, setProjectId] = useState("")
  const [selectedAgentId, setSelectedAgentId] = useState("")
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelIndex, setModelIndex] = useState(-1)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelStale, setModelStale] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [isolated, setIsolated] = useState(true)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agents = useMemo(() => machine ? selectableMachineAgents(machine) : [], [machine])
  const selectedProject = projects.find((project) => project.id === projectId)
  const agent = agents.find((candidate) => candidate.id === selectedAgentId)
  const canStart = Boolean(taskConfig && agent && projectId && prompt.trim() && !modelLoading && !modelError) && !starting

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      setTaskConfig(null)
      setMachine(null)
      setProjects([])
      setSelectedAgentId("")
      try {
        const connection = await discoverMachineConnection(config)
        if (!connection) throw new Error(taskText(t, "task.requiresDaemon"))
        const knownProjects = await taskClient.listProjects(connection.config)
        if (cancelled) return
        const availableAgents = selectableMachineAgents(connection.machine)
        if (!availableAgents.length) throw new Error(taskText(t, "task.agentUnavailable"))
        setTaskConfig(connection.config)
        setMachine(connection.machine)
        setProjects(knownProjects)
        setProjectId(knownProjects[0]?.id ?? "")
        setSelectedAgentId(preferredAgentID(connection.machine, config))
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      modelGuardRef.current.invalidate()
    }
  }, [config, t])

  useEffect(() => {
    if (!taskConfig || !selectedAgentId) {
      modelGuardRef.current.invalidate()
      setModels([])
      setModelIndex(-1)
      setModelLoading(false)
      return
    }

    const guard = modelGuardRef.current
    const token = guard.begin({
      profileID: profile.id,
      configKey: `${taskConfig.backend}|${taskConfig.host}|${taskConfig.port}|${selectedAgentId}`,
      sessionID: null,
      directory: null
    })
    setModels([])
    setModelIndex(-1)
    setModelLoading(true)
    setModelStale(false)
    setModelNotice(null)
    setModelError(null)

    void taskClient.listAgentModels(taskConfig, selectedAgentId).then((catalog) => {
      if (!guard.isCurrent(token)) return
      setModels(catalog.models)
      setModelIndex(catalog.models.findIndex((option) => option.isDefault))
      setModelStale(catalog.stale)
      setModelNotice(catalog.stale ? (catalog.error ?? "Model catalog could not be refreshed.") : null)
    }).catch((cause) => {
      if (!guard.isCurrent(token)) return
      setModelError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (guard.isCurrent(token)) setModelLoading(false)
    })
  }, [profile.id, selectedAgentId, taskConfig])

  async function start() {
    if (!canStart || !taskConfig || !agent) return
    setStarting(true)
    setError(null)
    try {
      const model = models[modelIndex]
      let task = await taskClient.createTask(taskConfig, {
        projectId,
        agentId: agent.id,
        prompt: prompt.trim(),
        model: model && { providerID: model.providerID, modelID: model.modelID, variant: model.variant }
      })
      if (isolated && selectedProject?.kind === "git") task = await taskClient.prepareWorktree(taskConfig, task.id)
      task = await taskClient.launch(taskConfig, task.id)
      onLaunched(task)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }

  const machineName = machine?.machine.name ?? profile.name

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card wizard task-launch-dialog fade-in" role="dialog" aria-modal="true" aria-labelledby="new-task-title" onClick={(event) => event.stopPropagation()}>
        <div className="wizard-header">
          <div className="wizard-header-text">
            <h2 id="new-task-title">{taskText(t, "task.new")}</h2>
            <p className="subtle">{taskText(t, "task.subtitle", { machine: machineName })}</p>
          </div>
          <button type="button" className="btn-icon btn-ghost task-launch-close" onClick={onClose} aria-label={t("session.cancel")}><CloseIcon size={16} /></button>
        </div>

        <div className="wizard-body">
          {loading ? (
            <div className="empty-state compact"><LoadingIcon size={26} /><p>{taskText(t, "task.loading")}</p></div>
          ) : error ? (
            <div className="error fade-in">✗ {error}</div>
          ) : projects.length === 0 ? (
            <div className="empty-state compact"><FolderIcon size={30} /><p>{taskText(t, "task.noProjects")}</p></div>
          ) : (
            <div className="task-launch-form">
              <div className="task-launch-context">
                <div className="task-context-item">
                  <span className="eyebrow">{taskText(t, "task.machine")}</span>
                  <strong><ServerIcon size={15} /><span className="truncate">{machineName}</span></strong>
                </div>
              </div>

              <label className="field task-launch-field task-launch-field--agent">
                <span>{taskText(t, "task.agent")}</span>
                <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
                  {agents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label ?? candidate.id}</option>)}
                </select>
              </label>

              <label className="field task-launch-field task-launch-field--project">
                <span>{taskText(t, "task.project")}</span>
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.path}</option>)}
                </select>
              </label>

              <label className="field task-launch-field task-launch-field--model">
                <span>{taskText(t, "task.model")}</span>
                {modelLoading ? (
                  <span className="subtle"><LoadingIcon size={14} /> {taskText(t, "task.modelLoading")}</span>
                ) : modelError ? (
                  <span className="error">✗ {modelError}</span>
                ) : (
                  <>
                    <select value={String(modelIndex)} onChange={(event) => setModelIndex(Number(event.target.value))}>
                      <option value="-1">{taskText(t, "task.modelDefault")}</option>
                      {models.map((option, index) => (
                        <option key={`${option.providerID}/${option.modelID}/${option.variant ?? ""}`} value={String(index)}>
                          {option.providerName} — {option.modelName}{option.variant ? ` (${option.variant})` : ""}
                        </option>
                      ))}
                    </select>
                    {modelStale && modelNotice && <span className="subtle">{modelNotice}</span>}
                  </>
                )}
              </label>

              <label className="field task-launch-field task-launch-field--prompt">
                <span>{taskText(t, "task.label")}</span>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={taskText(t, "task.promptPlaceholder")} rows={5} autoFocus />
              </label>

              <div className="task-launch-worktree">
                <label className="task-launch-check">
                  <input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} disabled={selectedProject?.kind !== "git"} />
                  <span><FolderIcon size={15} />{taskText(t, "task.isolatedWorktree")}</span>
                </label>
                {selectedProject?.kind !== "git" && <p className="subtle task-launch-note">{taskText(t, "task.nonGit")}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="wizard-footer task-launch-footer">
          <span className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>{t("session.cancel")}</button>
          <button type="button" className="btn-primary" disabled={!canStart} onClick={() => void start()}>
            {starting ? <LoadingIcon size={15} /> : <PlayIcon size={15} />}
            {starting ? taskText(t, "task.starting") : taskText(t, "task.start")}
          </button>
        </div>
      </section>
    </div>
  )
}
