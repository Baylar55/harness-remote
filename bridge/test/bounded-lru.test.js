import assert from "node:assert/strict"
import test from "node:test"
import { BoundedLru } from "../src/bounded-lru.js"

test("bounded LRU evicts the least recently used entry by count", () => {
  const cache = new BoundedLru({ maxEntries: 2 })
  cache.set("run-1", ["a"])
  cache.set("run-2", ["b"])
  assert.deepEqual(cache.get("run-1"), ["a"], "reading an entry must make it recent")
  cache.set("run-3", ["c"])

  assert.equal(cache.has("run-1"), true)
  assert.equal(cache.has("run-2"), false)
  assert.equal(cache.has("run-3"), true)
  assert.equal(cache.size, 2)
})

test("bounded LRU evicts by transcript weight even below the entry limit", () => {
  const cache = new BoundedLru({
    maxEntries: 10,
    maxWeight: 5,
    weightOf: (messages) => messages.length
  })
  cache.set("run-1", [1, 2, 3])
  cache.set("run-2", [4, 5, 6])

  assert.equal(cache.has("run-1"), false)
  assert.equal(cache.has("run-2"), true)
  assert.equal(cache.weight, 3)
})

test("replacing and deleting entries keep the tracked weight exact", () => {
  const cache = new BoundedLru({ maxEntries: 3, maxWeight: 20, weightOf: (value) => value.length })
  cache.set("a", "12345")
  cache.set("a", "12")
  cache.set("b", "123")
  assert.equal(cache.weight, 5)
  assert.equal(cache.delete("a"), true)
  assert.equal(cache.weight, 3)
  cache.clear()
  assert.equal(cache.weight, 0)
  assert.equal(cache.size, 0)
})
