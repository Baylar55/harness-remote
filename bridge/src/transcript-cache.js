import { BoundedLru } from "./bounded-lru.js"

const DEFAULT_MAX_ENTRIES = 8
const DEFAULT_MAX_WEIGHT = 24 * 1024 * 1024

function partWeight(part) {
  if (!part || typeof part !== "object") return 0
  let weight = 64
  if (typeof part.text === "string") weight += part.text.length
  if (typeof part.url === "string") weight += part.url.length
  if (typeof part.filename === "string") weight += part.filename.length
  if (typeof part.mime === "string") weight += part.mime.length
  if (part.state && typeof part.state === "object") {
    try { weight += JSON.stringify(part.state).length } catch {}
  }
  return weight
}

export function transcriptWeight(messages) {
  if (!Array.isArray(messages)) return 0
  let weight = 0
  for (const message of messages) {
    weight += 160
    if (typeof message?.info?.error?.message === "string") weight += message.info.error.message.length
    for (const part of message?.parts ?? []) weight += partWeight(part)
  }
  return weight
}

export class TranscriptCache {
  #lru
  #evictions = 0

  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxWeight = DEFAULT_MAX_WEIGHT,
    isProtected = () => false,
    onEvict = () => {}
  } = {}) {
    this.#lru = new BoundedLru({
      maxEntries,
      maxWeight,
      weightOf: transcriptWeight,
      canEvict: (key) => !isProtected(key),
      onEvict: (key, value, weight) => {
        this.#evictions += 1
        onEvict(key, value, weight)
      }
    })
  }

  get size() { return this.#lru.size }
  get weight() { return this.#lru.weight }
  has(key) { return this.#lru.has(key) }

  get(key) {
    const value = this.#lru.get(key)
    if (value !== undefined) this.#lru.refresh(key)
    return value
  }

  set(key, value) {
    this.#lru.set(key, value)
    return this
  }

  delete(key) { return this.#lru.delete(key) }
  clear() { this.#lru.clear() }
  keys() { return this.#lru.keys() }
  values() { return this.#lru.values() }
  entries() { return this.#lru.entries() }

  refresh(key) { return this.#lru.refresh(key) }

  stats() {
    this.#lru.refreshAll()
    return {
      entries: this.#lru.size,
      weight: this.#lru.weight,
      evictions: this.#evictions,
      maxEntries: this.#lru.maxEntries,
      maxWeight: this.#lru.maxWeight
    }
  }
}
