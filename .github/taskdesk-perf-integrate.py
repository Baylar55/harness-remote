from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


service_path = Path("bridge/src/acp-service.js")
service = service_path.read_text()
service = replace_once(
    service,
    'import path from "node:path"\n',
    'import path from "node:path"\nimport { TranscriptCache } from "./transcript-cache.js"\n',
    "transcript cache import",
)
service = replace_once(
    service,
    '  #messages = new Map()\n',
    '''  #messages = new TranscriptCache({\n    maxEntries: 8,\n    maxWeight: 24 * 1024 * 1024,\n    isProtected: (sessionID) => this.#active.has(sessionID)\n      || this.#replaying.has(sessionID)\n      || this.#loads.has(sessionID)\n      || Boolean(this.#queues.get(sessionID)?.length),\n    onEvict: (sessionID) => {\n      this.#loaded.delete(sessionID)\n      this.#restoredSnapshots.delete(sessionID)\n    }\n  })\n''',
    "message cache field",
)
service = replace_once(
    service,
    '''  subscribe(listener) {\n    this.#listeners.add(listener)\n    return () => this.#listeners.delete(listener)\n  }\n''',
    '''  subscribe(listener) {\n    this.#listeners.add(listener)\n    return () => this.#listeners.delete(listener)\n  }\n\n  diagnostics() {\n    return {\n      transcriptCache: this.#messages.stats(),\n      activeSessions: this.#active.size,\n      queuedSessions: this.#queues.size,\n      inFlightLoads: this.#loads.size,\n      snapshotWrites: this.#snapshotWrites.size,\n      subscribers: this.#listeners.size\n    }\n  }\n''',
    "service diagnostics",
)
service = replace_once(
    service,
    '''    await this.#load(sessionID, reloadHistory || this.#journalBacked(sessionID))\n    return this.#messages.get(sessionID) ?? []\n  }\n\n  /**\n   * Whether the harness's own on-disk history is the authority for this session rather than what\n''',
    '''    await this.#load(sessionID, reloadHistory || this.#journalBacked(sessionID))\n    return this.#messages.get(sessionID) ?? []\n  }\n\n  async messagePage(sessionID, { limit = 100, before, refresh = false } = {}) {\n    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100))\n    if (typeof this.#historyLoader?.page === "function" && !refresh && !this.#isBusy(sessionID)) {\n      try {\n        const page = await this.#historyLoader.page(sessionID, { limit: boundedLimit, before })\n        if (page && Array.isArray(page.messages)) return page\n      } catch {\n        this.#emit("session.error", sessionID, { message: "Harness session history page could not be read" })\n      }\n    }\n    const messages = await this.messages(sessionID, refresh)\n    const requestedEnd = before\n      ? messages.findIndex((message) => message?.info?.id === before)\n      : messages.length\n    const end = requestedEnd >= 0 ? requestedEnd : messages.length\n    const start = Math.max(0, end - boundedLimit)\n    return {\n      messages: messages.slice(start, end),\n      before: start > 0 ? messages[start]?.info?.id ?? null : null,\n      hasMore: start > 0\n    }\n  }\n\n  /**\n   * Whether the harness's own on-disk history is the authority for this session rather than what\n''',
    "message page method",
)
service = replace_once(
    service,
    '''      while (this.#dirtySnapshots.delete(sessionID)) {\n        const snapshot = JSON.stringify({\n          version: 1,\n          messages: this.#messages.get(sessionID) ?? [],\n          todos: this.#todos.get(sessionID) ?? [],\n''',
    '''      while (this.#dirtySnapshots.delete(sessionID)) {\n        const journalOwnsTranscript = Boolean(\n          this.#historyLoader && (this.#historyLoader.authoritativeHistory || this.#journalBacked(sessionID))\n        )\n        const snapshot = JSON.stringify({\n          version: 1,\n          messages: journalOwnsTranscript ? [] : this.#messages.get(sessionID) ?? [],\n          todos: this.#todos.get(sessionID) ?? [],\n''',
    "snapshot transcript ownership",
)
service_path.write_text(service)

server_path = Path("bridge/src/server.js")
server = server_path.read_text()
server = replace_once(
    server,
    '  const hiddenSessionIDs = serviceOptions?.hiddenSessionIDs\n  const liveSessionActivity = new Map()\n',
    '  const hiddenSessionIDs = serviceOptions?.hiddenSessionIDs\n  const liveSessionActivity = new Map()\n  let sseClients = 0\n',
    "SSE counter",
)
server = replace_once(
    server,
    '''          memory: {\n            rss: memory.rss,\n            heapTotal: memory.heapTotal,\n            heapUsed: memory.heapUsed,\n            external: memory.external,\n            arrayBuffers: memory.arrayBuffers\n          }\n''',
    '''          memory: {\n            rss: memory.rss,\n            heapTotal: memory.heapTotal,\n            heapUsed: memory.heapUsed,\n            external: memory.external,\n            arrayBuffers: memory.arrayBuffers\n          },\n          sseClients,\n          service: service.diagnostics()\n''',
    "diagnostics payload",
)
server = replace_once(
    server,
    '''        response.write(": connected\\n\\n")\n        const unsubscribe = service.subscribe((event) => writeSSE(response, event.type, event))\n        const heartbeat = setInterval(() => response.write(": ping\\n\\n"), config.heartbeatMs ?? 10_000)\n''',
    '''        response.write(": connected\\n\\n")\n        sseClients += 1\n        const unsubscribe = service.subscribe((event) => writeSSE(response, event.type, event))\n        const heartbeat = setInterval(() => response.write(": ping\\n\\n"), config.heartbeatMs ?? 10_000)\n''',
    "SSE increment",
)
server = replace_once(
    server,
    '''        request.on("close", () => {\n          clearInterval(heartbeat)\n          unsubscribe()\n        })\n''',
    '''        request.on("close", () => {\n          clearInterval(heartbeat)\n          unsubscribe()\n          sseClients = Math.max(0, sseClients - 1)\n        })\n''',
    "SSE decrement",
)
server = replace_once(
    server,
    '''          const messages = await service.messages(sessionID, url.searchParams.get("refresh") === "1")\n          writeJSON(response, 200, limit === undefined ? messages : messages.slice(-limit))\n          return\n''',
    '''          if (limit !== undefined || url.searchParams.has("before")) {\n            const page = await service.messagePage(sessionID, {\n              limit: limit ?? 100,\n              before: url.searchParams.get("before") || undefined,\n              refresh: url.searchParams.get("refresh") === "1"\n            })\n            if (page.before) response.setHeader("X-Next-Cursor", page.before)\n            response.setHeader("X-Has-More", page.hasMore ? "1" : "0")\n            writeJSON(response, 200, page.messages)\n            return\n          }\n          writeJSON(response, 200, await service.messages(sessionID, url.searchParams.get("refresh") === "1"))\n          return\n''',
    "message paging route",
)
server_path.write_text(server)
