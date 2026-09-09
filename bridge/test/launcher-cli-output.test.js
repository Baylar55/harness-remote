import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import test from "node:test"

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, () => {
      server.off("error", reject)
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
}

test("launcher reports an occupied explicit port without appending Usage", async (t) => {
  const listener = createServer()
  const port = await listen(listener, "127.0.0.1")
  t.after(() => new Promise((resolve) => listener.close(resolve)))

  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../src/launcher.js", import.meta.url)),
    "--backend", "codex",
    "--host", "0.0.0.0",
    "--port", String(port)
  ], { encoding: "utf8" })

  assert.equal(result.status, 1)
  assert.match(result.stderr, new RegExp(`Harness Remote cannot use 0\\.0\\.0\\.0:${port}`))
  assert.doesNotMatch(result.stderr, /Usage: harness-remote/)
})
