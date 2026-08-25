import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { sessionTreeRows } from "./components/native-session-home.tsx"

function item(id, parentID) {
  return {
    machine: { id: "machine-1", name: "Machine" },
    record: {
      key: id,
      agentId: "opencode",
      agentLabel: "OpenCode",
      backend: "opencode",
      transport: "http",
      abortSupported: true,
      modelsSupported: true,
      session: {
        id,
        parentID,
        title: id,
        directory: "/repo",
        time: { created: 1, updated: 1 }
      }
    }
  }
}

const rows = sessionTreeRows([
  item("child-2", "root"),
  item("root"),
  item("orphan", "missing"),
  item("child-1", "root"),
  item("cycle-a", "cycle-b"),
  item("cycle-b", "cycle-a"),
  item("self", "self")
])

assert.deepEqual(rows.map(({ item: row, depth }) => [row.record.session.id, depth]), [
  ["root", 0],
  ["child-2", 1],
  ["child-1", 1],
  ["orphan", 0],
  ["self", 0],
  ["cycle-a", 0],
  ["cycle-b", 1]
])
assert.equal(new Set(rows.map(({ item: row }) => row.record.session.id)).size, 7, "cycles or missing parents must never hide or duplicate a native Session")

const source = readFileSync(new URL("./components/native-session-home.tsx", import.meta.url), "utf8")
assert.match(source, /presentationOverrides/, "live detail status must survive selecting another Session")
assert.match(source, /\{ \.\.\.current, \[selectedKey\]: selectedState \}/, "the status bridge must be keyed by native Session identity")
assert.match(source, /setPresentationOverrides\(\{\}\)[\s\S]*setRecords\(results\.flatMap/, "a successful native discovery must retire temporary presentation overrides")
assert.match(source, /presentationOverrides\[targetKey\]/, "non-selected rows must retain their last observed live state until discovery reconciles them")

console.log("native Session Home tree and status reconciliation tests passed")
