# agent-tab

> A tiny CLI that prints today's token usage and cost for your AI coding agent — designed to slot into Claude Code's `statusLine` so the number sits right above your prompt input.

```
[claude] session $0.08 · today $0.42 · 12.3k tok · claude-sonnet-4-6
```

Supports **Claude Code**, **Codex CLI**, and **Gemini CLI**. You pick one active agent at a time; switch with `agent-tab use <agent>`.

---

## Why

Token bills for AI coding agents are easy to lose track of — three CLIs, three dashboards, three accounts. `agent-tab` reads the on-disk session logs each agent already writes, computes today's cost locally, and shows it where you'll actually see it: above the prompt in Claude Code.

No daemon, no database, no telemetry, no network calls. One short-lived CLI run per statusLine refresh.

## Install

Prereqs: Node 20+.

```bash
git clone https://github.com/srikar0805/agent-tab.git
cd agent-tab
npm install
npm run build
npm link              # makes `agent-tab` available on PATH
```

Verify:

```bash
agent-tab --version
agent-tab status      # prints today's usage for the active agent
```

## Wire into Claude Code's statusLine

Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "agent-tab"
  }
}
```

Reload Claude Code (or just start a new session). You'll see the tab appear above the prompt and refresh after each assistant turn.

## Commands

| Command | What it does |
| --- | --- |
| `agent-tab` *(no args)* | Prints the active agent's usage line. This is the form Claude Code calls. |
| `agent-tab status [--provider=<agent>] [--no-color]` | Same as above, with one-shot overrides. |
| `agent-tab use <claude\|codex\|gemini>` | Persistently sets the active agent. |
| `agent-tab show` | Prints the active agent. |
| `agent-tab --help` / `--version` | Usage / version. |

The active agent is stored in `$XDG_CONFIG_HOME/agent-tab/config.json` (`~/.config/agent-tab/config.json` on macOS/Linux).

## What each provider reads

| Agent | Source | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | Sums today's `assistant.message.usage` across all projects. Session window scoped to `transcript_path` from stdin when invoked by statusLine. Honors `CLAUDE_CONFIG_DIR`. |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Codex emits **cumulative** `token_count` events per session — `agent-tab` diffs them to derive per-turn deltas. Session window = most-recently-modified rollout of the day. Honors `CODEX_HOME`. |
| Gemini CLI | `~/.gemini/telemetry.log` | OpenTelemetry log of `gemini_cli.api_response` events. **Requires telemetry to be enabled** (`telemetry.target = "local"` in `~/.gemini/settings.json`); otherwise the CLI reports `telemetry not enabled` instead of zero. Honors `GEMINI_HOME`. |

Pricing for known models is in [`assets/pricing.json`](assets/pricing.json). Unknown models contribute zero cost (you'll still see the token count and the model name in the output) — open a PR to add new entries.

## Layout

```
src/
  cli.ts                   Entry: argv router, stdin reader
  config.ts                Read/write the active-agent config
  pricing.ts               Load pricing.json, lookup by name/alias, compute cost
  format.ts                Build the statusLine output (with ANSI colors)
  time.ts                  startOfTodayMs / todayDateParts helpers
  providers/
    types.ts               Provider interface, AgentSnapshot, StatusContext
    index.ts               Name → instance registry
    claude.ts              Claude Code JSONL parser
    codex.ts               Codex JSONL parser (cumulative-diff aware)
    gemini.ts              Gemini telemetry parser
test/
  *.test.ts                vitest unit tests (no fixtures on disk — tests synthesize them)
assets/
  pricing.json             Per-model $/M-token rates with aliases
```

Build is plain `tsc` → `dist/`. Zero runtime dependencies.

## Privacy

- All processing is local. The CLI reads files under your home directory and prints to stdout. It makes no network calls and writes no state outside `$XDG_CONFIG_HOME/agent-tab/config.json`.
- The stdin payload from Claude Code's statusLine (`session_id`, `transcript_path`, etc.) is consumed in memory and never persisted.

## Limitations

- **Only Claude Code has a true statusLine.** Codex CLI and Gemini CLI have hooks but neither renders custom output above the prompt. You can still see their numbers via `agent-tab use codex && agent-tab` or by integrating with a shell prompt (starship, oh-my-zsh, etc.).
- **Gemini requires telemetry to be enabled.** Without it, there's no on-disk token data.
- **Models without pricing show $0.00.** The bundled pricing table doesn't cover every model — particularly fast-moving Codex/OpenAI variants. Token counts are still accurate.

## License

MIT — see [LICENSE](./LICENSE).
