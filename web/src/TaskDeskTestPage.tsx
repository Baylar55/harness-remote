import { useMemo, useState } from "react"
import { TaskLaunchDialog } from "./components/task-launch-dialog"
import { createTranslator, normalizeLanguage } from "./i18n"
import type { MachineTask } from "./taskClient"

function runReference(task: MachineTask): string | null {
  return task.run?.sessionId ?? task.run?.sessionID ?? task.run?.id ?? null
}

/**
 * Explicit integration-only surface for real-harness TaskDesk testing.
 *
 * It is reachable only when the URL contains `?taskdesk-test=1`; the normal application remains
 * untouched. The dialog itself reads the same saved active profile as Harness Remote, so configure
 * the server normally first, then open this surface to exercise machine/project/model/task launch.
 */
export function TaskDeskTestPage() {
  const t = useMemo(() => createTranslator(normalizeLanguage(localStorage.getItem("opencode.remote.language") || navigator.language)), [])
  const [open, setOpen] = useState(true)
  const [launchedTask, setLaunchedTask] = useState<MachineTask | null>(null)

  if (!open) {
    return (
      <main className="panel taskdesk-test-page fade-in">
        <div className="section-heading">
          <div>
            <h2>TaskDesk integration test</h2>
            <p className="subtle">Normal Harness Remote is unchanged. This page exists only on the integration branch.</p>
          </div>
        </div>
        {launchedTask && (
          <section className="taskdesk-launch-result" aria-live="polite" aria-labelledby="taskdesk-launch-result-title">
            <span className="taskdesk-launch-result-mark" aria-hidden="true">✓</span>
            <div className="taskdesk-launch-result-heading">
              <p className="eyebrow">Task started</p>
              <h3 id="taskdesk-launch-result-title">Codex is now working on your task</h3>
              <p className="subtle">The task was created and sent to the Harness machine daemon successfully.</p>
            </div>
            <dl className="taskdesk-launch-details">
              <dt>Task</dt>
              <dd><code>{launchedTask.id}</code></dd>
              <dt>Agent</dt>
              <dd>{launchedTask.agentId}</dd>
              <dt>Project</dt>
              <dd>{launchedTask.project.name}</dd>
              <dt>Workspace</dt>
              <dd><code>{launchedTask.workspace.path}</code></dd>
              <dt>Run</dt>
              <dd>{runReference(launchedTask) ? <code>{runReference(launchedTask)}</code> : launchedTask.run?.status ?? launchedTask.status}</dd>
            </dl>
          </section>
        )}
        <div className="inline-actions">
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Open New Task</button>
          <button type="button" className="btn-secondary" onClick={() => { window.location.href = window.location.pathname }}>Back to Harness Remote</button>
        </div>
      </main>
    )
  }

  return (
    <TaskLaunchDialog
      t={t}
      onClose={() => setOpen(false)}
      onLaunched={(task) => setLaunchedTask(task)}
    />
  )
}
