const MOBILE_QUERY = "(max-width: 680px)"
const SESSION_DETAIL_CLASS = "td3-mobile-session-detail"
const BACK_BUTTON_CLASS = "td3-mobile-session-back"

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

/**
 * TaskDesk reuses UniversalWorkspace on desktop, but a phone needs a navigation stack instead of a
 * split pane. Keep the state local to the TaskDesk shell: selecting a Session drills into its full
 * conversation, while the explicit Sessions navigation always returns to the list. This avoids
 * changing Classic 2.x or the standalone UniversalWorkspace layout.
 */
export function installTaskDeskMobileNavigation(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined

  let openExactSession = false
  let openCreatedSession = false
  const media = window.matchMedia(MOBILE_QUERY)

  const sync = () => {
    const root = sessionsRoot()
    if (!root) return
    if (!media.matches) {
      root.classList.remove(SESSION_DETAIL_CLASS)
      root.querySelector(`.${BACK_BUTTON_CLASS}`)?.remove()
      return
    }
    if (openExactSession || openCreatedSession) {
      const hasConversation = Boolean(root.querySelector(".uw-session-header"))
      if (hasConversation) {
        root.classList.add(SESSION_DETAIL_CLASS)
        openExactSession = false
        openCreatedSession = false
      }
    }
    ensureSessionBackButton()
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    if (target.closest(`.${BACK_BUTTON_CLASS}`)) {
      event.preventDefault()
      showSessionList()
      return
    }

    const taskDeskNav = target.closest(".td3-sidebar nav button")
    if (taskDeskNav && buttonLabel(taskDeskNav).includes("Sessions")) {
      openExactSession = false
      openCreatedSession = false
      queueMicrotask(showSessionList)
      return
    }

    const openSessionButton = target.closest(".td3-task-detail-open button")
    if (openSessionButton && buttonLabel(openSessionButton) === "Open Session") {
      openExactSession = true
      return
    }

    if (target.closest(".td3-sessions-embedded .uw-session-card")) {
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
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener("click", onClick, true)
  media.addEventListener("change", sync)
  sync()

  return () => {
    observer.disconnect()
    document.removeEventListener("click", onClick, true)
    media.removeEventListener("change", sync)
  }
}
