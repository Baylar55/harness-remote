#!/usr/bin/env node
/*
 * Drive a real `omp acp` installation through the multi-turn Session lifecycle.
 *
 * A fake, however carefully it is written against the upstream source, can only prove that the
 * bridge is consistent with what we read. This runs the same code against the OMP the user actually
 * has, and reports the five facts the fake asserts:
 *
 *   1. the adapter advertises `session/resume`, so the writer can be taken without a replay;
 *   2. a new Session answers its first prompt;
 *   3. it answers the ones after it, in the same Session, without a `session/load`;
 *   4. every read hands back the same identity for a message it already returned;
 *   5. every answer converges on its complete text.
 *
 * It writes real Sessions into the OMP session directory of whoever runs it, and spends real
 * tokens, so it is deliberately opt-in and never part of CI:
 *
 *   node bridge/scripts/omp-real-smoke.mjs [--cwd <absolute path>] [--turns 3]
 */
import { AcpClient } from "../src/acp-client.js"
import { AcpPromptEchoFilter } from "../src/acp-prompt-echo-filter.js"
import { AcpService } from "../src/acp-service.js"
import { HARNESS_PROFILES, resolveAcpLaunch } from "../src/harness-profiles.js"
import { findExecutable } from "../src/launcher.js"

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const directory = argument("cwd", process.cwd())
const turns = Math.max(1, Number(argument("turns", "3")) || 3)
const profile = HARNESS_PROFILES.omp

if (!findExecutable(profile.command)) {
  console.error("`omp` is not on PATH. Install Oh My Pi first; this smoke deliberately does not fake it.")
  process.exit(2)
}

const launch = resolveAcpLaunch(profile)
const acp = new AcpClient({ command: launch.command, args: launch.args, permissionMode: profile.permissionMode })
const service = new AcpService(new AcpPromptEchoFilter(acp), {
  historyLoader: profile.historyLoader,
  reloadOnHistoryRefresh: profile.reloadOnHistoryRefresh,
  journalPageWhileOwned: profile.journalPageWhileOwned !== false,
  modelVariantConfigIDs: profile.modelVariantConfigIDs
})

const loads = []
const originalRequest = acp.request.bind(acp)
acp.request = (method, params, timeout) => {
  if (method === "session/load" || method === "session/resume") loads.push(method)
  return originalRequest(method, params, timeout)
}

const failures = []
function check(condition, description) {
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`)
  if (!condition) failures.push(description)
}

function text(messages) {
  return messages.map((message) => [
    message.info.role,
    message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")
  ])
}

try {
  await acp.start()
  console.log(`OMP ${acp.agentInfo?.version ?? "?"} via ${launch.command} (${launch.source})`)
  check(Boolean(acp.sessionCapabilities?.resume), "advertises session/resume")

  const created = await service.createSession({ directory, title: "Harness Remote smoke" })
  console.log(`session ${created.id} in ${directory}`)

  let previous = []
  for (let turn = 1; turn <= turns; turn += 1) {
    const prompt = `Reply with exactly this and nothing else: SMOKE-${turn}`
    await service.promptAndWait(created.id, prompt)
    const messages = (await service.messagePage(created.id, { limit: 200 })).messages
    const ids = messages.map((message) => message.info.id)

    check(
      messages.some((message) => message.info.role === "user" && message.parts.some((part) => part.text === prompt)),
      `turn ${turn}: the prompt is in the transcript`
    )
    const answer = text(messages).filter(([role]) => role === "assistant").at(-1)?.[1] ?? ""
    check(answer.includes(`SMOKE-${turn}`), `turn ${turn}: the complete answer is present (${JSON.stringify(answer.slice(0, 80))})`)
    check(new Set(ids).size === ids.length, `turn ${turn}: no message appears twice`)
    check(
      previous.every((id, index) => ids[index] === id),
      `turn ${turn}: earlier messages keep the identity the previous read gave them`
    )
    previous = ids
    check(service.status(created.id).type === "idle", `turn ${turn}: the Session is Ready again`)
  }

  check(!loads.includes("session/load"), `no session/load was needed (calls: ${loads.join(", ") || "none"})`)
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.error(error)
} finally {
  acp.close()
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
