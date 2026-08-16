import React from "react"
import ReactDOM from "react-dom/client"
import { Capacitor } from "@capacitor/core"
import App from "./App"
import { ErrorBoundary } from "./ErrorBoundary"
import { SERVER_STORAGE_KEYS } from "./storageKeys"
import "./styles.css"

const taskDeskTestMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get("taskdesk-test") === "1"

async function renderApp() {
  let content: React.ReactNode = <App />
  if (taskDeskTestMode) {
    const { TaskDeskTestPage } = await import("./TaskDeskTestPage")
    content = <TaskDeskTestPage />
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary resetKeys={SERVER_STORAGE_KEYS}>
        {content}
      </ErrorBoundary>
    </React.StrictMode>
  )
}

void renderApp()

if (import.meta.env.PROD && !Capacitor.isNativePlatform() && !window.harnessDesktop?.platform.isDesktop && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
  })
}
