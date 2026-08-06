import type { ContextBridge, IpcRenderer } from "electron"
import type {
  DesktopCompletionNotification,
  DesktopEvent,
  DesktopEventMessage,
  DesktopEventStatus,
  DesktopEventSubscriptionOptions,
  DesktopProfile,
  DesktopProfileSyncResult,
  DesktopRequest,
  DesktopRequestResult
} from "./ipc-contract.js" with { "resolution-mode": "import" }

const { contextBridge, ipcRenderer } = require("electron") as { contextBridge: ContextBridge; ipcRenderer: IpcRenderer }
const IPC_CHANNELS = Object.freeze({
  replaceProfiles: "desktop:profiles:replace",
  request: "desktop:request",
  subscribeEvents: "desktop:events:subscribe",
  unsubscribeEvents: "desktop:events:unsubscribe",
  notifyCompletion: "desktop:completion:notify",
  event: "desktop:events:event"
})

type EventCallbacks = {
  onEvent: (event: DesktopEvent) => void
  onStatus?: (status: DesktopEventStatus) => void
}

const callbacks = new Map<string, EventCallbacks>()
ipcRenderer.on(IPC_CHANNELS.event, (_event: Electron.IpcRendererEvent, message: DesktopEventMessage) => {
  if (!message || typeof message.subscriptionId !== "string") return
  const callback = callbacks.get(message.subscriptionId)
  if (!callback) return
  if (message.kind === "event") callback.onEvent(message.event)
  else callback.onStatus?.(message.status)
})

const harnessDesktop = Object.freeze({
  platform: Object.freeze({ isDesktop: true, os: process.platform }),
  replaceProfiles(profiles: DesktopProfile[], revision: number): Promise<DesktopProfileSyncResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.replaceProfiles, profiles, revision)
  },
  request(profileId: string, request: DesktopRequest): Promise<DesktopRequestResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.request, profileId, request)
  },
  async subscribeEvents(
    profileId: string,
    options: DesktopEventSubscriptionOptions,
    onEvent: EventCallbacks["onEvent"],
    onStatus?: EventCallbacks["onStatus"]
  ): Promise<string> {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.subscribeEvents, profileId, options) as { subscriptionId: string }
    callbacks.set(result.subscriptionId, { onEvent, onStatus })
    return result.subscriptionId
  },
  async unsubscribeEvents(subscriptionId: string): Promise<void> {
    callbacks.delete(subscriptionId)
    await ipcRenderer.invoke(IPC_CHANNELS.unsubscribeEvents, subscriptionId)
  },
  notifyCompletion(notification: DesktopCompletionNotification): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.notifyCompletion, notification)
  }
})

contextBridge.exposeInMainWorld("harnessDesktop", harnessDesktop)
