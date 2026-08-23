import { useEffect, useRef, type RefObject } from "react"

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",")

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement)
}

/**
 * Shared modal behaviour for every dialog in the 3.0 shell.
 *
 * Before this hook the dialogs were closable only by clicking the backdrop or the × button: Escape
 * did nothing, focus stayed behind the dialog so a keyboard or screen-reader user kept tabbing
 * through the workspace underneath, and closing a dialog dropped focus onto `<body>`.
 *
 * Autofocus is deliberately opt-out: a dialog whose first field is a textarea on a phone would
 * otherwise raise the on-screen keyboard over its own form.
 */
export function useDialogDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { autoFocus?: boolean; enabled?: boolean } = {}
): void {
  const { autoFocus = true, enabled = true } = options
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const container = ref.current
    // A component that renders one of two dialogs calls this hook twice, and the branch that is not
    // rendered has a null ref. Without this guard that unused instance still registered a document
    // Escape listener with no container, so it closed the dialog even when an open popover inside
    // the rendered one should have consumed the key first.
    if (!enabled || !container) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (autoFocus && !container.contains(document.activeElement)) {
      const target = container.querySelector<HTMLElement>("[data-autofocus]") || focusable(container)[0] || container
      target.focus?.()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An open popover inside the dialog owns Escape first. Without this, dismissing the model
        // picker also threw away the New Conversation form the user had just filled in.
        if (container.querySelector(".tdw-model-picker.open")) return
        closeRef.current()
        return
      }
      if (event.key !== "Tab") return
      const items = focusable(container)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!container.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      // Returning focus to the control that opened the dialog is what keeps keyboard navigation
      // from restarting at the top of the workspace every time a dialog is dismissed.
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [ref, autoFocus, enabled])
}
