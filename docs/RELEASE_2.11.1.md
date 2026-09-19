# Harness Remote 2.11.1

Harness Remote 2.11.1 is a bug-fix release for the 2.11 line. It repairs three ways a session could look emptier than it was, and restores per-agent routing in the Desktop application.

## Highlights

- Show the full conversation when opening a task session after a daemon restart, instead of the single prompt recorded at launch.
- Route every Desktop server profile to the agent it selected, instead of sending them all to the machine's primary agent.
- Report the provider's own reason when a turn fails, instead of leaving the prompt followed by nothing.
- Recover a task session's transcript on harnesses that keep no journal of their own, which previously had no path back to it at all.
- Collapse repeated identical failures from a retried turn into one.

## Task session history after a daemon restart

Opening a task session after restarting the daemon showed the one prompt recorded when the task was launched, and nothing else, until a new message streamed in and filled the rest of the conversation.

The daemon adopts every known task session at startup so a thread another client holds open can still be prompted without `session/load`. That adoption also marked the session's in-memory transcript complete, which meant the harness's own rollout or journal was never read. Adoption is now tracked separately: it grants the right to prompt, and history still comes from the harness until the bridge runs a turn of its own on the session.

Codex was the harness this was reported against, because every Codex task session behaved this way. PI was unaffected only because its loader is already marked authoritative and bypasses the affected path. Claude Code, which keeps no journal for the bridge to read, now replays an adopted session over ACP — a recovery path adoption previously prevented outright.

This release also stops two loads of the same session from overlapping. A transcript-only load and a config-options load both rebuild the session's message list, and the client asks for both every time a session is opened, so a caller that wanted only the transcript could read a half-rebuilt one.

## Desktop agent routing

In the packaged Desktop application every saved server listed the same sessions: those of the machine daemon's primary agent.

A profile's agent id is what scopes its requests to one agent behind the shared machine endpoint. The Desktop main process was discarding that field when it validated a profile, leaving it with a machine-root target for every server, and the daemon routes an unscoped request to its primary agent. The Web client was unaffected because it builds its own URLs and never lost the field.

The main process now keeps and validates the agent id, and treats a change of agent as a real change so the event stream follows it. The compatibility header the daemon uses to correct a wrongly-scoped request is now shared by the browser, Desktop and Android request paths rather than being sent by the browser alone, which is what allowed the two clients to disagree in the first place.

Existing Desktop profiles repair themselves on the next launch; no reconfiguration is needed.

## Failed turns

A turn that fails carries the provider's message on the envelope rather than in the reply, and nothing displayed it. The prompt was followed by nothing at all — the same thing a session with a broken transcript looks like, which is why two unrelated causes were reported as one problem.

- The Oh My Pi and PI journal readers keep a failed turn instead of discarding it for having no content, and carry the provider's sentence with it.
- A live ACP turn failure is recorded on the transcript rather than only announced once, so it is still there when the session is reopened.
- The client renders the reason inside the bubble, and folds consecutive identical failures together, since a harness that retries a failing turn records one failed message per attempt.

## Also fixed

- A duplicate React key in the session sidebar, where one project directory legitimately produces several groups.

## Validation

- web type-check and production build
- web regression tests
- desktop transport and profile registry tests
- bridge test suite
- runtime validation against a live machine daemon with Codex CLI, Claude Code, Oh My Pi, PI and OpenCode: per-agent session lists verified distinct from both the Web and Desktop clients, task session transcripts verified complete before and after a daemon restart, and a live turn verified not to duplicate or lose history
