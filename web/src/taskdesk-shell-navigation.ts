import { useEffect, useRef, useState } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { isAndroidPlatform } from "./desktopBridge"

/** Phones get a navigation stack instead of a split pane. One query, one source of truth. */
export const TASKDESK_MOBILE_QUERY = "(max-width: 680px)"

/**
 * TaskDesk used to decide its responsive behavior from a MutationObserver that rewrote the DOM
 * React had just produced. Reading the media query as state instead keeps the layout decision in
 * the component that owns the navigation, so nothing has to observe or repair the rendered tree.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener("change", sync)
    // A media-query change event is not guaranteed for every way a viewport can change — a webview
    // resized by a soft keyboard or a rotation handled by the host can move the width without one.
    // Resize is the reliable signal, and reading `matches` keeps the result identical either way.
    window.addEventListener("resize", sync)
    return () => {
      media.removeEventListener("change", sync)
      window.removeEventListener("resize", sync)
    }
  }, [query])

  return matches
}

/**
 * One dismissal stack for every way a user asks to go back.
 *
 * Classic 2.x already unwinds Android's hardware back through layered state, and on a modern
 * Android device the edge-swipe-back gesture is delivered to the webview as that same `backButton`
 * event, so wiring it here gives TaskDesk both the button and the gesture. Escape gives desktop and
 * the browser the same order of operations, which is what stops a modal from being unclosable by
 * keyboard.
 *
 * `steps` is read through a ref because the Android listener is registered once and must never
 * capture a stale view.
 */
export function useBackNavigation(steps: Array<() => boolean>, { exitOnRoot = true } = {}): void {
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  useEffect(() => {
    const goBack = (): boolean => {
      for (const step of stepsRef.current) {
        if (step()) return true
      }
      return false
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (goBack()) event.preventDefault()
    }
    document.addEventListener("keydown", onKeyDown)

    let handle: { remove: () => void } | undefined
    let removed = false
    if (isAndroidPlatform(Capacitor.getPlatform())) {
      void CapacitorApp.addListener("backButton", () => {
        if (goBack()) return
        if (exitOnRoot) CapacitorApp.exitApp()
      }).then((registered) => {
        // The effect can be torn down before registration resolves.
        if (removed) void registered.remove()
        else handle = registered
      })
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      removed = true
      handle?.remove()
    }
  }, [exitOnRoot])
}
