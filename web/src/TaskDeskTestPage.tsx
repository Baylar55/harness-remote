import { useMemo, useState } from "react"
import { TaskLaunchDialog } from "./components/task-launch-dialog"
import { createTranslator, normalizeLanguage } from "./i18n"

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
  const [launchCount, setLaunchCount] = useState(0)

  if (!open) {
    return (
      <main className="panel fade-in" style={{ maxWidth: 720, margin: "3rem auto" }}>
        <div className="section-heading">
          <div>
            <h2>TaskDesk integration test</h2>
            <p className="subtle">Normal Harness Remote is unchanged. This page exists only on the integration branch.</p>
          </div>
        </div>
        {launchCount > 0 && <p>Task launch callback received ({launchCount}). Check the runtime and session/task lists.</p>}
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
      onLaunched={() => setLaunchCount((value) => value + 1)}
    />
  )
}
