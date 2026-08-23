import assert from "node:assert/strict"
import test from "node:test"
import { acpHarnessCapabilityContract, openCodeCapabilityContract } from "../src/harness-capability-contract.js"
import { harnessProfile } from "../src/harness-profiles.js"

test("ACP capability contract preserves runtime-specific model controls without inventing them", () => {
  const omp = acpHarnessCapabilityContract(harnessProfile("omp"))
  const pi = acpHarnessCapabilityContract(harnessProfile("pi"))
  const claude = acpHarnessCapabilityContract(harnessProfile("claude"))

  assert.equal(omp.protocol, "acp")
  assert.equal(omp.transport.control, "stdio-json-rpc")
  assert.equal(omp.models.cacheScope, "project-cwd")
  assert.ok(omp.models.variantConfigIDs.includes("thinking"))
  assert.ok(pi.models.variantConfigIDs.some((id) => ["thinkingLevel", "thinking_level", "thinking"].includes(id)))
  assert.deepEqual(claude.models.variantConfigIDs, [])
  assert.equal(claude.models.variants, "runtime-advertised-only")
})

test("OpenCode capability contract describes daemon-owned SSE fanout and runtime provider models", () => {
  const contract = openCodeCapabilityContract()
  assert.equal(contract.protocol, "opencode-http")
  assert.equal(contract.transport.control, "http-json")
  assert.equal(contract.transport.events, "sse-daemon-fanout")
  assert.equal(contract.toolCalls.representation, "opencode-message-parts")
  assert.equal(contract.models.source, "runtime-provider-api")
  assert.equal(contract.models.cacheScope, "machine")
  assert.equal(contract.models.variants, "provider-advertised")
  assert.equal(contract.lifecycle.sessionAuthority, "native-harness")
})
