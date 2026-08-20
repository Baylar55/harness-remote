# TaskDesk performance track

This track is intentionally separate from the TaskDesk UI and navigation work in PR #261.

## Goals

- Keep daemon memory bounded during long-running Android, desktop and browser use.
- Make live TaskDesk state feel immediate without aggressive whole-workspace polling.
- Keep session indexes lightweight regardless of transcript count or transcript size.
- Load long conversations incrementally instead of materializing full journals by default.

## Architecture

### 1. Event-driven freshness

Use daemon session events as the primary invalidation signal where available. Events should trigger targeted refreshes for the affected session, task or attention state. Periodic polling remains a slow reconciliation fallback for disconnects, missed events and backends that cannot provide equivalent event semantics.

### 2. Bounded transcript cache

Opened transcripts may be cached for navigation responsiveness, but the cache must have explicit limits by session count and message count or approximate payload size. Least-recently-used entries are evicted first. Session listing, status counting and search must never depend on cached transcript bodies.

### 3. Real history pagination

Conversation APIs should support bounded pages and a cursor or before-token. Opening a session loads the newest page first. Older history is fetched only when the user requests or scrolls toward it. A small `limit=1` or preview request must never force the daemon to reconstruct a complete ACP history.

### 4. Targeted detail loading

Task and Session detail surfaces should request only the data needed for the visible page or tab. Hidden mobile pages and inactive desktop panes must not keep background detail loops alive.

## Memory acceptance gates

The previous failing daemon exceeded 4 GB of V8 heap. The hardened candidate measured about 42 MB heap and 142 MB RSS after several minutes of real Android use.

Before this track is merged:

- repeated navigation across many sessions must plateau rather than grow monotonically;
- session index operations must stay metadata-only under synthetic historical-session pressure;
- opening and closing long transcripts must release or evict cached bodies according to the configured bound;
- hidden WebViews must not perform repeating refresh work;
- diagnostics must remain available for real-device soak tests.

## Delivery order

1. Event invalidation and slow polling fallback.
2. Bounded transcript cache with eviction tests.
3. Paginated conversation API and newest-page-first UI.
4. Soak tests using `/v1/diagnostics` on Android and browser.
5. Merge only after PR #261 UI behavior and this performance track pass independently.

## Safety

This branch targets `feature/taskdesk-unified-shell`. It does not target `main` or `v3/taskdesk` directly.