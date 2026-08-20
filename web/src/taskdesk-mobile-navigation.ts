const MOBILE_QUERY = "(max-width: 680px)"
const SESSION_DETAIL_CLASS = "td3-mobile-session-detail"
const BACK_BUTTON_CLASS = "td3-mobile-session-back"
const NEW_TASK_BUTTON_CLASS = "td3-mobile-new-task"
const NEW_SESSION_BUTTON_CLASS = "td3-mobile-new-session"

function isMobile(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
}

function sessionsRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".td3-sessions-embedded")
}

function showSessionList() {
  sessionsRoot()?.classList.remove(SESSION_DETAIL_CLASS)
}

function showSessionDetail() {
  if (!isMobile()) return
  sessionsRoot()?.classList.add(SESSION_DETAIL_CLASS)
}

function buttonLabel(target: Element | null): string {
  const button = target?.closest("button")
  return button?.textContent?.replace(/\s+/g, " ").trim() || ""
}

function ensureSessionBackButton() {
  const root = sessionsRoot()
  if (!root || !isMobile() || !root.classList.contains(SESSION_DETAIL_CLASS)) return
  const header = root.querySelector<HTMLElement>(".uw-session-header")
  if (!header || header.querySelector(`.${BACK_BUTTON_CLASS}`)) return
  const button = document.createElement("button")
  button.type = "button"
  button.className = BACK_BUTTON_CLASS
  button.setAttribute("aria-label", "Back to Sessions")
  button.textContent = "‹ Sessions"
  header.prepend(button)
}

function ensureMobileCreateActions() {
  if (!isMobile()) return

  const taskLayout = document.querySelector<HTMLElement>(".td3-tasks-layout-unified")
  const taskHeading = taskLayout?.querySelector<HTMLElement>(".td3-task-list-pane .td3-page-heading.compact")
  if (taskHeading && !taskLayout?.classList.contains("detail-open") && !taskHeading.querySelector(`.${NEW_TASK_BUTTON_CLASS}`)) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `td3-button primary ${NEW_TASK_BUTTON_CLASS}`
    button.textContent = "+ New Task"
    button.setAttribute("aria-label", "New Task")
    button.addEventListener("click", () => {
      const source = [...document.querySelectorAll<HTMLButtonElement>(".td3-topbar button")]
        .find((candidate) => buttonLabel(candidate) === "New Task")
      source?.click()
    })
    taskHeading.append(button)
  }

  const root = sessionsRoot()
  if (!root || root.classList.contains(SESSION_DETAIL_CLASS)) return
  const sessionHeader = root.querySelector<HTMLElement>(".uw-session-column-header")
  if (!sessionHeader || sessionHeader.querySelector(`.${NEW_SESSION_BUTTON_CLASS}`)) return
  const button = document.createElement("button")
  button.type = "button"
  button.className = `uw-button uw-button-primary ${NEW_SESSION_BUTTON_CLASS}`
  button.textContent = "+ New Session"
  button.setAttribute("aria-label", "New Session")
  button.addEventListener("click", () => {
    root.querySelector<HTMLButtonElement>(".uw-new-button")?.click()
  })
  sessionHeader.append(button)
}

/**
 * TaskDesk reuses UniversalWorkspace on desktop, but a phone needs a navigation stack instead of a
 * split pane. Keep the state local to the TaskDesk shell: selecting a Session drills into its full
 * conversation, while the explicit Sessions navigation always returns to the list. This avoids
 * changing Classic 2.x or the standalone UniversalWorkspace layout.
 *
 * TaskDesk deliberately hides some desktop chrome on a phone. The primary create actions are mirrored
 * into the visible mobile list pages and delegate to the existing React buttons, so they keep the same
 * validation and modal behavior instead of creating a second implementation of Task or Session setup.
 */
export function installTaskDeskMobileNavigation(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined

  let openExactSession = false
  let openCreatedSession = false
  let manuallySelectedSession: HTMLButtonElement | null = null
  let restoringManualSelection = false
  const media = window.matchMedia(MOBILE_QUERY)

  const restoreManualSelection = () => {
    if (!media.matches || restoringManualSelection || !manuallySelectedSession?.isConnected) return
    const root = sessionsRoot()
    if (!root?.classList.contains(SESSION_DETAIL_CLASS) || manuallySelectedSession.classList.contains("selected")) return
    restoringManualSelection = true
    queueMicrotask(() => {
      if (manuallySelectedSession?.isConnected && !manuallySelectedSession.classList.contains("selected")) {
        manuallySelectedSession.click()
      }
      restoringManualSelection = false
    })
  }

  const sync = () => {
    const root = sessionsRoot()
    if (!media.matches) {
      root?.classList.remove(SESSION_DETAIL_CLASS)
      root?.querySelector(`.${BACK_BUTTON_CLASS}`)?.remove()
      document.querySelector(`.${NEW_TASK_BUTTON_CLASS}`)?.remove()
      document.querySelector(`.${NEW_SESSION_BUTTON_CLASS}`)?.remove()
      manuallySelectedSession = null
      return
    }
    if (root && (openExactSession || openCreatedSession)) {
      const hasConversation = Boolean(root.querySelector(".uw-session-header"))
      if (hasConversation) {
        root.classList.add(SESSION_DETAIL_CLASS)
        openExactSession = false
        openCreatedSession = false
      }
    }
    ensureSessionBackButton()
    ensureMobileCreateActions()
    restoreManualSelection()
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    if (target.closest(`.${BACK_BUTTON_CLASS}`)) {
      event.preventDefault()
      manuallySelectedSession = null
      showSessionList()
      queueMicrotask(ensureMobileCreateActions)
      return
    }

    const taskDeskNav = target.closest(".td3-sidebar nav button")
    if (taskDeskNav && buttonLabel(taskDeskNav).includes("Sessions")) {
      openExactSession = false
      openCreatedSession = false
      manuallySelectedSession = null
      queueMicrotask(() => {
        showSessionList()
        ensureMobileCreateActions()
      })
      return
    }

    const openSessionButton = target.closest(".td3-task-detail-open button")
    if (openSessionButton && buttonLabel(openSessionButton) === "Open Session") {
      openExactSession = true
      manuallySelectedSession = null
      return
    }

    const sessionCard = target.closest<HTMLButtonElement>(".td3-sessions-embedded .uw-session-card")
    if (sessionCard) {
      manuallySelectedSession = sessionCard
      queueMicrotask(() => {
        showSessionDetail()
        ensureSessionBackButton()
      })
      return
    }

    const modalButton = target.closest(".td3-sessions-embedded .uw-modal-footer button")
    const label = buttonLabel(modalButton)
    if (label.includes("Start session") || label.includes("Create handoff session")) {
      openCreatedSession = true
      manuallySelectedSession = null
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] })
  document.addEventListener("click", onClick, true)
  media.addEventListener("change", sync)
  sync()

  return () => {
    observer.disconnect()
    document.removeEventListener("click", onClick, true)
    media.removeEventListener("change", sync)
  }
}
