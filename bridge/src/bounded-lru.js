export class BoundedLru {
  #entries = new Map()
  #weight = 0

  constructor({ maxEntries = 8, maxWeight = Infinity, weightOf = () => 1 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive integer")
    if (!(maxWeight > 0)) throw new Error("maxWeight must be greater than zero")
    if (typeof weightOf !== "function") throw new Error("weightOf must be a function")
    this.maxEntries = maxEntries
    this.maxWeight = maxWeight
    this.weightOf = weightOf
  }

  get size() {
    return this.#entries.size
  }

  get weight() {
    return this.#weight
  }

  has(key) {
    return this.#entries.has(key)
  }

  get(key) {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key, value) {
    const weight = Math.max(0, Number(this.weightOf(value, key)) || 0)
    const previous = this.#entries.get(key)
    if (previous) {
      this.#weight -= previous.weight
      this.#entries.delete(key)
    }
    this.#entries.set(key, { value, weight })
    this.#weight += weight
    this.#evict()
    return this
  }

  delete(key) {
    const entry = this.#entries.get(key)
    if (!entry) return false
    this.#entries.delete(key)
    this.#weight -= entry.weight
    return true
  }

  clear() {
    this.#entries.clear()
    this.#weight = 0
  }

  keys() {
    return this.#entries.keys()
  }

  #evict() {
    while (this.#entries.size > this.maxEntries || this.#weight > this.maxWeight) {
      const oldestKey = this.#entries.keys().next().value
      if (oldestKey === undefined) break
      this.delete(oldestKey)
    }
  }
}
