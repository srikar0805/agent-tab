# Coding Agent Monitor

> A unified VSCode pane for token usage, cost, and plan-quota status across **Claude Code**, **Codex CLI**, **Gemini CLI**, **GitHub Copilot**, **Cursor**, and custom AI coding agents.

**Status:** v0.1 — phase 1 scaffold (extension shell, store, sidebar empty state, status bar, command skeletons). Collectors land in phases 2–7. See [`DESIGN.md`](./DESIGN.md) for the full design and [`DESIGN.md` §15](./DESIGN.md) for the phase plan.

---

## Why this exists

Modern developers juggle multiple AI coding agents simultaneously. Each has its own pricing, plan limits, account, and dashboard. This extension answers four questions in one place:

1. **How many tokens did I burn today / this week / this month**, per agent and per model?
2. **How much did that cost** (or how much of my plan have I used)?
3. **Which account/email** did each session run under?
4. **Am I close to a rate limit or quota cap?**

Plus quality-of-life: switch active model per agent, switch active account profile, plug in custom agents, and reduce token spend via [graphify](https://github.com/safishamsi/graphify)-based code context.

## Highlights

- **Local-first.** All data stays on your disk in a SQLite store under VSCode's globalStorage. Zero outbound telemetry.
- **Multi-account.** Each event is tagged with the account/email that produced it. Profile picker switches the active credential set when launching agents.
- **Cross-machine aware.** Detects if your agent data dirs are synced via Dropbox / iCloud / OneDrive / Syncthing / Nextcloud and dedupes accordingly.
- **Theme-aware UI.** React + Tailwind webview maps to VSCode's CSS variables — looks native in any theme.
- **Production-grade.** Schema migrations from day one, WAL-mode SQLite, refuses to run on a sync-rooted globalStorage to prevent corruption.

## Quickstart (development)

Prereqs: Node 20+, VSCode 1.90+, native build tools (`xcode-select --install` on macOS / `build-essential` on Linux / Visual Studio Build Tools on Windows) for `better-sqlite3`.

```bash
git init                       # not yet a git repo
npm install
npm run rebuild                # rebuild better-sqlite3 against your VSCode's Electron
npm run build                  # build extension host + webview into dist/
```

Then open the project in VSCode and press **F5** to launch a development host with the extension loaded. The status-bar item appears bottom-right; the sidebar lives behind the activity-bar icon.

### Running tests

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run typecheck      # tsc --noEmit on host + webview
npm run lint           # eslint
```

### Packaging a VSIX

```bash
npm run package        # produces coding-agent-monitor-0.1.0.vsix
code --install-extension coding-agent-monitor-0.1.0.vsix
```

## Project layout

```
src/                  Extension host (TypeScript, esbuild → dist/extension.js)
  extension.ts        Activation entry
  platform/paths.ts   Cross-platform agent-data path resolvers + sync-marker list
  store/              SQLite store, migrations, dashboard queries
  collectors/         Collector interface + manager (concrete collectors land in phase 2+)
  ui/                 Status bar + sidebar WebviewViewProvider
  commands/           Command palette handlers

webview-src/          Sidebar UI (React + Tailwind, vite → dist/webview/)
  App.tsx             Top-level component
  components/         EmptyState, Header, TotalsBar, primitives
  lib/vscode.ts       Typed postMessage bus

assets/
  pricing.json        Local pricing table (refreshable via command)
  activity-bar-icon.svg

test/                 Vitest unit tests
.github/workflows/    CI matrix (linux/mac/windows) + tagged-release VSIX artifact
```

## Roadmap

See [`DESIGN.md` §15](./DESIGN.md). Highlights:

- **Phase 1 (this scaffold).** Extension shell, store, sidebar empty state, status bar, command skeletons. ✅
- **Phase 2.** Claude Code collector — full E2E parsing of `~/.claude/projects/**/*.jsonl`.
- **Phase 3.** Codex + Gemini collectors via shared JSONL reader.
- **Phase 4.** MCP tool-use facet (parse `mcp__*` tool calls from host JSONLs).
- **Phase 5.** GitHub Copilot via `/user/copilot/billing`.
- **Phase 6.** Profile model + tagging across all providers.
- **Phase 7.** Cursor stub + experimental SQLite read.
- **Phase 8.** MCP standalone-server collector.
- **Phase 9.** Custom-agent plugin loader.
- **Phase 10.** Active profile switching (`buildLaunchSpec`) + Launch Agent quick-pick.
- **Phase 11.** Graphify integration (sidebar Graph Context card + per-agent MCP wiring).
- **Phase 12.** Quota caps + Issues tab.
- **Phase 13.** Pricing updater + Export/Import (CSV/JSON) + sync-root detection banner.
- **Phase 14.** Polish, packaging, marketplace listing.

## Privacy

- Zero outbound telemetry.
- Optional Anthropic / OpenAI Admin API integrations require explicit opt-in; keys live in VSCode's `SecretStorage`.
- Reading agent credential files is read-only; bearer tokens are never copied into our SQLite.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `codingAgentMonitor.pollIntervalSeconds` | `60` | How often to scan agent log directories. |
| `codingAgentMonitor.retentionDays` | `365` | Days of raw event data before rolling up to daily aggregates. |
| `codingAgentMonitor.cursor.experimentalLocalRead` | `false` | (Experimental) Read Cursor's local SQLite — may break on Cursor updates. |
| `codingAgentMonitor.quotas` | `{}` | User-configured plan-quota caps (for Pro/Max plans without an API). |
| `codingAgentMonitor.customAgents` | `[]` | Manifest paths for custom agents. See `DESIGN.md` §6.7. |

## License

MIT — see [LICENSE](./LICENSE).
