# agent-tab — Design Notes

A short architectural reference for the CLI. For user-facing docs see [README.md](./README.md).

> **Earlier direction.** The repo originally targeted a VSCode extension (sidebar webview + SQLite store + status bar). That scaffold lives in the snapshot commit immediately before this file changed; `git log` reveals it. The pivot to a CLI happened because (a) Claude Code's `statusLine` is a first-class hook for printing custom text above the prompt input, which matches the actual user need better than a sidebar, and (b) a one-shot CLI has no database, no native modules, no Electron-ABI footguns, and no continuous-process resource footprint.

## What it is

A short-lived Node CLI that:

1. Reads the **active agent** from a tiny on-disk config (`~/.config/agent-tab/config.json`).
2. Reads that agent's session logs from disk (no daemon, no IPC).
3. Tallies today's tokens, multiplies by the bundled pricing table, and prints one line to stdout.
4. Exits.

Designed to be re-invoked on every Claude Code statusLine refresh (debounced 300ms by Claude Code). Per-invocation work must stay fast.

## Data flow

```
Claude Code statusLine
   │
   │ stdin: { session_id, transcript_path, workspace.current_dir, ... }
   ▼
agent-tab (process)
   │
   ├─ read ~/.config/agent-tab/config.json  → activeAgent: claude | codex | gemini
   ├─ providers[activeAgent].snapshot(ctx)
   │     │
   │     ├─ claude  → ~/.claude/projects/*/*.jsonl
   │     ├─ codex   → ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
   │     └─ gemini  → ~/.gemini/telemetry.log
   │
   ├─ apply pricing from assets/pricing.json
   └─ format → stdout (single line, ANSI-colored unless NO_COLOR)
```

## Provider contract

```ts
interface Provider {
  readonly name: AgentName;                       // 'claude' | 'codex' | 'gemini'
  snapshot(ctx: StatusContext): Promise<AgentSnapshot>;
}

interface StatusContext {
  sessionId?: string;                             // from stdin JSON
  transcriptPath?: string;                        // from stdin JSON
  cwd?: string;
}

interface AgentSnapshot {
  agent: AgentName;
  today: UsageWindow;                             // since local midnight
  session?: UsageWindow;                          // current or most-recent session
  warning?: string;                               // graceful degradation message
}

interface UsageWindow {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  primaryModel?: string;
}
```

## Provider quirks worth knowing

**Claude Code.** Each assistant message line carries `usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }` and `model`. Files are appended to in real time; the parser tolerates a partial trailing line by trimming the empty last element after `split('\n')`. Today-filter uses the in-line `timestamp` (ISO 8601), not file mtime, because a long-running session's file mtime spans midnight.

**Codex CLI.** `payload.type === 'token_count'` events carry **cumulative** totals per session in `payload.info.total_token_usage`. Per-turn deltas come from diffing consecutive values, clamped at zero (in case of session resets). The active model for a turn is the most recent `payload.type === 'turn_context'` event's `model` field, defaulting to `'unknown'`.

**Gemini CLI.** No JSONL session log — token data lives in `~/.gemini/telemetry.log`, an OpenTelemetry-formatted log that requires the user to set `telemetry.target = "local"` in `~/.gemini/settings.json`. When the file is missing the provider returns `{ today: emptyWindow(), warning: 'telemetry not enabled — ...' }` rather than zero, because zero would be misleading. The relevant event is `gemini_cli.api_response` with attributes `model`, `input_token_count`, `output_token_count`, `cached_content_token_count`, `session.id`.

## Active-agent model

The active agent is a persistent, user-explicit choice — not auto-detected. Rationale: Claude Code's statusLine is non-interactive (just stdout from a shell command), so any "switch the displayed agent" UX has to live outside the statusLine. We use a tiny config file modified via `agent-tab use <agent>`. The default is `claude` because that's the only agent that natively renders a statusLine.

For the active agent's `session` window:

- If `ctx.sessionId` or `ctx.transcriptPath` matches a known session file (Claude case when statusLine is firing inside Claude Code), use that session.
- Otherwise, fall back to "most recent session today" (Codex case, where we're invoked from Claude Code's statusLine but the active agent is Codex).
- If no session of the active agent ran today, omit `session` from the output entirely.

## Pricing

[`assets/pricing.json`](assets/pricing.json) — `unit: per_million_tokens`, `currency: USD`. Each model entry has `input`, `output`, optionally `cache_read` and `cache_write`, plus an `aliases` array for date-stamped or vendor-prefixed variants (e.g. `anthropic.claude-opus-4-7-v1:0`).

Unknown model → cost 0 (silent). A follow-up will switch the display to `$?` when tokens > 0 but the cost is zero due to missing pricing, so the gap is visible to the user instead of being indistinguishable from an idle day.

Free-model glob patterns (`ollama:*`, `llamacpp:*`) match unconditionally and return zero rates.

## Non-goals

- No daemon, no background polling, no caching across invocations. The whole CLI runs <100ms on a normal day's worth of logs.
- No history beyond "today" — no SQLite, no time-series storage. If you want week/month aggregations, the upstream JSONLs are still on disk; layer that on top later.
- No GitHub Copilot, Cursor, or custom agents. Copilot's billing API requires network calls and OAuth; Cursor's local store is undocumented and breaks between versions; both can come later behind feature flags if there's demand.
- No multi-agent aggregation in the output line. The user picks one agent at a time. Aggregation is a separate UX problem (multi-line statusLine, or a separate `agent-tab summary` command).

## Test strategy

Vitest, fully synthetic fixtures (no on-disk sample logs). Each provider test:

1. `mkdtemp` a unique temp dir.
2. Set the provider's env override (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_HOME`) to point inside it.
3. Write a few JSONL/telemetry fixture lines.
4. Call `provider.snapshot()` and assert on the returned `AgentSnapshot`.
5. Tear down.

Pricing cache is reset between tests via the `_resetPricingCache()` test helper. The CLI itself isn't tested via child-process spawn — the surface area is small enough that the typed unit tests cover behavior well.

## Open questions

- Does it make sense to surface the active agent's *plan-quota* (e.g., Claude Max usage) in the same line? Would require a network call to provider APIs, which contradicts the "no network" promise. Probably belongs in a separate `agent-tab quota` command opt-in.
- Should `agent-tab status` emit machine-readable JSON when stdout is not a TTY, to support shell-prompt integrations cleanly? Currently it always emits the human line.
- Is "today" the right window? "Past 24 hours" might be more useful around midnight rollovers, but "today" is what the user sees on provider dashboards.
