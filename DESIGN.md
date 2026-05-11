# Coding Agent Monitor — Design Document

> A VSCode extension that surfaces token usage, cost, and plan-quota status across multiple AI coding agents (Claude Code, Codex CLI, Gemini CLI, GitHub Copilot, Cursor, custom agents), with multi-account/profile support and per-agent model switching.

**Status:** Draft v0.1 — pre-implementation. Awaiting review before scaffolding.

---

## 1. Overview

Modern developers juggle several AI coding agents simultaneously. Each has its own pricing, plan limits, account, and dashboard. This extension provides a **single in-editor pane of glass** that answers four questions at any time:

1. How many tokens did I burn today / this week / this month, per agent and per model?
2. How much did that cost (or how much of my plan have I used)?
3. Which account/email did each session run under?
4. Am I close to a rate limit or quota cap?

Plus quality-of-life: switch the active model per agent, switch the active account profile, and plug in custom agents.

---

## 2. Goals & Non-Goals

### Goals
- **G1** Aggregate usage from Claude Code, Codex CLI, Gemini CLI, Copilot, Cursor, and user-defined custom agents.
- **G2** Present daily / weekly / monthly totals broken down by agent, model, and profile.
- **G3** Compute cost from a versioned local pricing table when provider APIs don't expose cost directly.
- **G4** Display plan-quota usage where the provider exposes it (Copilot premium requests; Anthropic Admin API for org keys; OpenAI Usage API).
- **G5** Allow tagging usage events with the account/email they ran under, even when multiple accounts are used per provider.
- **G6** Allow launching an agent under a chosen profile (env-var-based switching, no clobbering of credential files).
- **G7** Provide a plugin interface so users can add custom agents without forking.
- **G8** Local-first: all data stays on disk; no telemetry leaves the machine.

### Non-Goals
- **NG1** Replacing the agents' own UIs or chat surfaces.
- **NG2** Real-time interception of in-flight requests (we read after the fact).
- **NG3** Cracking provider plan-quota APIs that aren't publicly documented (e.g., scraping Cursor's dashboard with stored cookies — fragile, ToS-risky; explicitly out of scope).
- **NG4** Cross-machine sync. Users on multiple machines see each machine's local view.

---

## 3. User Stories

- **US1** *Daily check-in.* "I open VSCode, glance at the sidebar, and see I've used $4.20 across Claude Code + Codex today, with 60% of that on Sonnet."
- **US2** *Plan ceiling alarm.* "It's Wednesday and I've already burned 80% of my Claude Max weekly budget — show a yellow warning in the status bar."
- **US3** *Account split.* "My work email handles Claude Code; my personal email handles Codex. The dashboard separates the two, and a profile picker lets me switch which credentials a new terminal launches with."
- **US4** *Model switch.* "I want to run the next Claude Code session on Haiku instead of Sonnet — picker in the command palette runs `claude --model haiku-4-5` in a new terminal."
- **US5** *Custom agent.* "I built my own agent. I drop a `coding-agent-monitor.json` manifest in its config dir pointing at its session logs, and it shows up in the dashboard."

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  VSCode Extension Host                    │
│                                                           │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────┐  │
│  │  Sidebar   │   │  Status Bar    │   │  Command     │  │
│  │  Webview   │   │  Item          │   │  Palette     │  │
│  └─────┬──────┘   └────────┬───────┘   └──────┬───────┘  │
│        │                   │                  │          │
│        └─────────┬─────────┴──────────────────┘          │
│                  │                                       │
│            ┌─────▼──────┐    ┌────────────────────┐      │
│            │ Aggregator │◄───┤  SQLite Store      │      │
│            │  Service   │    │  (better-sqlite3)  │      │
│            └─────┬──────┘    └─────────▲──────────┘      │
│                  │                     │                 │
│         ┌────────┴─────────┐           │                 │
│         │ Collector Manager│───────────┘                 │
│         └────────┬─────────┘   writes UsageEvent rows    │
│                  │                                       │
│   ┌──────┬───────┼───────┬──────┬───────┬────────┐      │
│   ▼      ▼       ▼       ▼      ▼       ▼        ▼      │
│ Claude  Codex  Gemini  Copilot Cursor Custom   ...      │
│  Code   CLI     CLI                  (plugins)          │
│ Collector Collector Collector Collector ...             │
└──────────────────────────────────────────────────────────┘
        │         │        │        │         │
        ▼         ▼        ▼        ▼         ▼
  ~/.claude  ~/.codex ~/.gemini  GitHub    Cursor
  /projects  /sessions  /tmp     API +     local DB
                              VSCode logs  (best-effort)
```

### Components

- **Extension host (TS).** Wires up VSCode contributions: `views`, `commands`, `statusBar`, `configuration`. Owns the **Aggregator Service**.
- **Collector Manager.** Discovers and instantiates one collector per supported provider, scheduled on a configurable poll interval (default 60s) plus manual refresh.
- **Collector (per provider).** Implements `UsageCollector` (§5.4). Responsible for: discovering installation, listing profiles, parsing local logs, calling provider APIs when configured, emitting `UsageEvent` rows.
- **SQLite store.** Append-only event log + materialized rollups. Single file at `${globalStorageUri}/usage.db`.
- **Aggregator Service.** Reads from store, computes daily/weekly/monthly aggregates, exposes them to webview via VSCode's `postMessage` API.
- **Sidebar webview.** Vue/React/preact (TBD §15) UI rendering charts and tables.

---

## 5. Data Model

### 5.1 `UsageEvent`

The atomic unit of work. Every interaction with an agent that we can observe becomes one or more events.

```ts
interface UsageEvent {
  id: string;                      // hash of (provider, profile_id, session_id, message_index)
  provider: ProviderId;            // 'claude-code' | 'codex' | 'gemini' | 'copilot' | 'cursor' | `custom:${string}`
  profile_id: string;              // FK to profile
  session_id: string;              // provider-native session id (jsonl filename, etc.)
  workspace_path: string | null;   // best-effort cwd of the session, for filtering
  timestamp: number;               // unix ms — when the assistant turn completed
  model: string;                   // canonical model id, e.g. 'claude-sonnet-4-6', 'gpt-5-codex'
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;   // 0 if N/A
  cache_read_tokens: number;       // 0 if N/A
  cost_usd: number | null;         // null if not derivable (e.g. Copilot premium-req only)
  premium_requests: number;        // for Copilot-style request-count metering; 0 otherwise
  raw_meta: Record<string, any>;   // provider-specific extras we may want later
}
```

### 5.2 `Profile`

```ts
interface Profile {
  id: string;                      // synthetic id
  provider: ProviderId;
  email: string | null;            // displayed in UI; null if undiscoverable
  account_id: string | null;       // provider-side stable id when available
  display_name: string;            // user-editable label
  config_dir: string | null;       // path used when launching the agent under this profile
  env: Record<string, string>;     // env vars to set when launching
  created_at: number;
  last_seen_at: number;
}
```

### 5.3 `PlanQuota` (provider-reported, optional)

```ts
interface PlanQuota {
  provider: ProviderId;
  profile_id: string;
  window: 'daily' | 'weekly' | 'monthly';
  used: number;                    // units depend on provider
  limit: number;
  unit: 'tokens' | 'usd' | 'requests' | 'messages';
  fetched_at: number;
  source: 'api' | 'inferred-from-error' | 'user-configured';
}
```

When a provider doesn't expose quota (Claude Code Pro/Max), users can manually configure expected limits in settings, and the extension will compare local-computed usage against them.

### 5.4 `UsageCollector` interface

```ts
interface UsageCollector {
  readonly id: ProviderId;
  readonly displayName: string;

  // Detect whether the agent is installed/used on this machine.
  isAvailable(): Promise<boolean>;

  // Enumerate accounts known to the agent. May be inferred from credential files.
  listProfiles(): Promise<Profile[]>;

  // Collect events newer than `since`. Implementation must be incremental and idempotent.
  collect(since: Date): Promise<UsageEvent[]>;

  // Fetch quota where supported. Return [] if not.
  getPlanQuotas(profile: Profile): Promise<PlanQuota[]>;

  // Build a launch command/env for a given profile + model. Used by the "launch in terminal" command.
  buildLaunchSpec(profile: Profile, opts: { model?: string; cwd?: string }):
    { command: string; args: string[]; env: Record<string, string> } | null;
}
```

---

## 6. Per-Provider Collectors

Each subsection covers: data sources, extraction approach, profile/email discovery, plan-quota access, model-switch mechanism, known limitations.

### 6.1 Claude Code

- **Data source:** `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is an event; assistant messages carry `model` plus `usage: {input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`.
- **Extraction:** Tail each session's JSONL, track byte offset per file in our SQLite store, parse new lines incrementally. Reference: open-source `ccusage` does exactly this — we'll port the parsing logic, not depend on it (avoid runtime dep on a third-party tool).
- **Profile discovery:** read `~/.claude/.credentials.json` (OAuth) and `~/.claude.json` (config). Email is stored in OAuth payload after login. For multi-account, users with separate `CLAUDE_CONFIG_DIR`s each show as a distinct profile.
- **Plan quotas:** **No public API for Pro/Max plan usage.** Two fallbacks:
  - User-configured weekly/5-hour caps in extension settings, compared against locally-summed cost.
  - For Anthropic API keys / Console plans: optional Admin API integration (`/v1/organizations/.../usage_report/messages`) — requires user to paste an admin key, opt-in.
- **Model switch:** `claude --model <id>` flag when launching from extension's "Run in terminal" command.
- **Limitations:** Plan-quota % is inferred, not authoritative. Rate-limit signals only appear in error responses, which we'd see post-hoc in the JSONL.

### 6.2 Codex CLI (OpenAI)

- **Data source:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — JSONL session rollouts that include token counts and model.
- **Extraction:** Same incremental tail approach. Track per-file byte offsets.
- **Profile discovery:** `~/.codex/auth.json` holds OAuth token + email for ChatGPT-plan auth; `OPENAI_API_KEY` env var path is API-key auth. Distinct profiles per auth file / per env-var preset.
- **Plan quotas:**
  - For API-key users: **OpenAI Usage API** (`/v1/organization/usage/completions`) — requires user opt-in with admin key.
  - For ChatGPT-plan users: no public API; same user-configured caps fallback.
- **Model switch:** `codex -m <model>` flag.
- **Limitations:** Codex's session-file format has changed historically; collector must be schema-version-tolerant.

### 6.3 Gemini CLI

- **Data source:** `~/.gemini/tmp/<workspace-hash>/*.json` (checkpoints) and chat session files. Token counts present in `usageMetadata` on each turn.
- **Extraction:** Polling for new files + size-change detection.
- **Profile discovery:** `~/.gemini/oauth_creds.json` for Google account; `GEMINI_API_KEY` / `GOOGLE_API_KEY` for API. Email available from OAuth payload.
- **Plan quotas:** Google AI Studio / Vertex have usage endpoints, but Gemini CLI's free-tier RPM/RPD limits aren't directly queryable. Same user-configured fallback.
- **Model switch:** `gemini --model <id>`.
- **Limitations:** Gemini CLI's data format is the youngest of the four CLIs; expect more churn.

### 6.4 GitHub Copilot

- **Data source (request counting):** GitHub REST API `GET /user/copilot/billing` (for individual seats) and `GET /orgs/{org}/copilot/billing/seats` (org). These return premium-request counts and remaining quota — Copilot's authoritative metering unit.
- **Data source (chat content, optional):** Copilot Chat stores transcripts under `~/Library/Application Support/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/`. Token counts are **not** persisted there, only message content. We can count *messages* but not tokens.
- **Profile discovery:** GitHub user is whichever account the `GITHUB_TOKEN` (or VSCode's GitHub auth session) belongs to. Profile = GitHub login.
- **Plan quotas:** ✅ premium-request percentage — the cleanest quota signal of any provider in this list.
- **Cost:** Copilot's individual plans are flat-rate; cost = subscription fee, not per-request. We display "$X / Y of your Z premium requests this month" instead.
- **Model switch:** Copilot's model picker is internal to the extension — we link to the VSCode command `github.copilot.chat.selectModel` rather than trying to override it.
- **Limitations:** No raw token counts. Org-level data requires admin OAuth scope.

### 6.5 Cursor

**Hybrid: stub-by-default, opt-in experimental local read.**

- **Default mode (stub):** Card shows "Cursor data not collected automatically — open dashboard" with a button linking to `cursor.com/settings`. Reliable, never breaks.
- **Experimental mode:** Behind setting `codingAgentMonitor.cursor.experimentalLocalRead = true`. Reads `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (SQLite). Collector is wrapped in defensive try/catch with schema fingerprinting — if the schema differs from any known fingerprint, it disables itself for that Cursor version and surfaces a "schema changed, awaiting collector update" notice rather than producing wrong numbers.
- **Profile discovery:** in experimental mode, email retrievable from `state.vscdb` auth tables.
- **Plan quotas:** dashboard only — no scraping, ever.
- **Model switch:** Cursor's model picker is internal to Cursor; cannot be driven from our extension.
- **Limitations:** experimental mode is best-effort and explicitly marked as such in the UI. README will document that Cursor data may stop flowing on a Cursor update until we ship a fingerprint update.

### 6.6 MCP servers

Two distinct flows to handle, because "MCP usage" means different things:

**6.6.a — MCP tool-use tokens spent by a host agent**

When Claude Code (or any host) calls an MCP tool, the tool-use turn's input/output tokens are recorded inside the host's normal session JSONL. **No new collection required.** What we add is a **breakdown facet**: each `UsageEvent` carries an optional `tool_calls: [{ server, tool, count }]` extracted from the host's session record, and the dashboard exposes a "by MCP server" pivot ("how many tokens did your MCP toolchain consume in Claude Code today?").

Implementation: extend the Claude Code / Codex / Gemini collectors' parsers to also extract `tool_use` blocks targeting MCP servers (identifiable by the `mcp__<server>__<tool>` naming convention) and accumulate them in `raw_meta.tool_calls`.

**6.6.b — MCP servers that make their own LLM calls**

Some MCP servers (e.g., aggregators, "thinking" servers, agent-style MCPs) call LLM APIs themselves with their own credentials. Those calls are invisible to the host's session log. Handling:

- We auto-discover configured MCP servers from `~/.claude.json` (`mcpServers` section) and equivalents in Codex/Gemini configs, so the dashboard at least *lists* them with a "log location unknown" badge.
- For known logging conventions, the user registers a log path via the same custom-agent manifest (§6.7) using `provider: "mcp:<server-name>"`. The MCP collector reuses the custom-agent parser.

**Limitations**

- No standardized MCP logging spec exists. Discovery is config-file-based; per-server log parsing is opt-in.
- Cost attribution for 6.6.a still goes to the host agent (because that's where the bill lands), but the breakdown lets users see *which* MCP servers are driving their token spend.

### 6.7 Custom agents (plugin)

- **Manifest format** (`coding-agent-monitor.json` placed by user, registered via setting `codingAgentMonitor.customAgents`):

```json
{
  "id": "my-agent",
  "displayName": "My Agent",
  "logDir": "~/.my-agent/sessions",
  "logFormat": "jsonl",
  "fields": {
    "timestamp": "$.ts",
    "model": "$.model",
    "input_tokens": "$.usage.input",
    "output_tokens": "$.usage.output"
  },
  "pricing": {
    "lookup": "shared"
  },
  "launch": {
    "command": "my-agent",
    "modelFlag": "--model"
  }
}
```

- For more complex parsing: a TypeScript plugin path that exports a `UsageCollector`. Loaded via `vm` sandbox (review security implications — likely require explicit user consent on first load).

---

## 7. Storage

- **File:** `${context.globalStorageUri}/usage.db` — SQLite via `better-sqlite3`.
- **Schema (DDL):**

```sql
CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  profile_id      TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  workspace_path  TEXT,
  timestamp       INTEGER NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL,
  premium_requests INTEGER NOT NULL DEFAULT 0,
  raw_meta        TEXT
);
CREATE INDEX events_provider_ts ON events (provider, timestamp);
CREATE INDEX events_profile_ts  ON events (profile_id, timestamp);

CREATE TABLE profiles (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  email        TEXT,
  account_id   TEXT,
  display_name TEXT NOT NULL,
  config_dir   TEXT,
  env_json     TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE collector_state (
  provider     TEXT NOT NULL,
  source_path  TEXT NOT NULL,            -- e.g. session file path
  byte_offset  INTEGER NOT NULL DEFAULT 0,
  last_run_at  INTEGER,
  PRIMARY KEY (provider, source_path)
);

CREATE TABLE plan_quotas (
  provider     TEXT NOT NULL,
  profile_id   TEXT NOT NULL,
  window       TEXT NOT NULL,
  used         REAL NOT NULL,
  limit_value  REAL NOT NULL,
  unit         TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  source       TEXT NOT NULL,
  PRIMARY KEY (provider, profile_id, window)
);

CREATE TABLE collector_issues (
  id           TEXT PRIMARY KEY,           -- hash(provider, source_path, kind, message)
  provider     TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  kind         TEXT NOT NULL,              -- 'parse' | 'schema' | 'network' | 'permission' | 'other'
  message      TEXT NOT NULL,
  source_path  TEXT,
  resolved_at  INTEGER                     -- null while unresolved
);
CREATE INDEX collector_issues_unresolved ON collector_issues (resolved_at) WHERE resolved_at IS NULL;
```

The `events` table inserts use `INSERT OR IGNORE` keyed by `id` so re-parsed JSONL files (e.g., from a synced data directory) collapse to a single row — see §16 OQ3.

- **Retention:** Configurable; default keep events for 365 days, then aggregate into a daily-rollup table and drop raw rows.

---

## 8. Pricing & Cost Calculation

- **Pricing table:** `assets/pricing.json` shipped in the extension VSIX.
  ```json
  {
    "claude-sonnet-4-6": { "input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.30, "unit": "per_million_tokens" },
    "claude-opus-4-7":   { "input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50, "unit": "per_million_tokens" },
    "gpt-5-codex":       { "input": 1.25, "output": 10.0, "unit": "per_million_tokens" },
    "gemini-2.5-pro":    { "input": 1.25, "output": 5.0, "unit": "per_million_tokens" }
  }
  ```
- **Refresh:** A command `Coding Agent Monitor: Update Pricing Table` fetches a signed JSON from a public GitHub release. **Never automatic** — pricing changes are a trust-sensitive update, user opts in.
- **Computation:**
  ```
  cost_usd = (input_tokens × input_rate
            + output_tokens × output_rate
            + cache_creation_tokens × cache_write_rate
            + cache_read_tokens × cache_read_rate) / 1_000_000
  ```
- Models not present in the table → `cost_usd = null`, flagged in UI as "no pricing data."

---

## 9. UI / UX

### 9.1 Status bar item

`$(graph) $4.20 today · 62%` — clicking opens the sidebar.

- Color: default → green; >50% of any configured cap → yellow; >85% → red.
- Issues dot: small filled circle appended (`$(graph) $4.20 today · 62% ●`) when `unresolved_issues > 0`. Clicking opens the Issues tab.

### 9.2 Sidebar (Activity Bar icon)

Three sections:

**Header**
- Today / Week / Month / **Issues** tabs (Issues badge shows count when `> 0`)
- Profile filter (multi-select chip row)
- Refresh button

**Issues tab (per OQ6)**
- Table of unresolved collector failures: timestamp · collector · kind · message · "Open log" / "Dismiss"
- Empty state: "All collectors healthy."

**Sync banner (per OQ3)**
- Renders above the per-provider cards on first detection of a synced data dir; dismissable per data-dir, persisted in extension global state.

**Per-provider cards** (one card each: Claude Code, Codex, Gemini, Copilot, Cursor, MCP, custom)
- Token total (in/out, cache hit %)
- Cost (or "No cost data" / "Premium requests: X / Y")
- Quota bar if configured (vs API-reported limit, or user-configured cap)
- Top model breakdown (sparkline)
- "Launch with profile…" button → command palette flow

**MCP breakdown** (collapsible, sourced from §6.6.a)
- Stacked bar of MCP-tool token consumption per host agent
- Top MCP servers by token spend this week
- Servers with "log location unknown" badge linking to docs on registering one

**Recent sessions table** (collapsible)
- 20 most recent sessions across all agents
- Columns: time, agent, model, profile, tokens, cost
- Row click → opens the session log in editor (read-only)

### 9.3 Command palette

- `Coding Agent Monitor: Open Dashboard`
- `Coding Agent Monitor: Refresh Now`
- `Coding Agent Monitor: Launch Agent…` (picks agent → profile → model → opens new terminal with env+args)
- `Coding Agent Monitor: Set Quota Caps…`
- `Coding Agent Monitor: Add Custom Agent…`
- `Coding Agent Monitor: Update Pricing Table`
- `Coding Agent Monitor: Export Usage…` (CSV for spreadsheets, JSON for cross-machine import — see §10.3)
- `Coding Agent Monitor: Import Usage…` (JSON, idempotent via `INSERT OR IGNORE`)

---

## 10. Profile & Multi-Account Management

Two distinct concerns, deliberately separated:

### 10.1 Tagging (always on)

Every collected event is tagged with the profile it ran under, by reading the agent's own credential/config file at parse time. This works regardless of how the user launched the agent and provides "show me work-email Claude vs personal-email Claude" splits in the dashboard.

### 10.2 Active switching (opt-in, per-provider)

Mechanism: `buildLaunchSpec(profile)` returns a `{command, args, env}` triple that the extension uses to spawn a new VSCode terminal. We **never** rewrite the agent's credential files in place — that races with running sessions and risks data loss.

Per-provider env-var recipes:

| Provider | Recipe |
|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR=<profile.config_dir>` |
| Codex CLI | `CODEX_HOME=<profile.config_dir>` (or `OPENAI_API_KEY=<…>` for API mode) |
| Gemini CLI | `GEMINI_CONFIG_DIR` (if supported) or `GEMINI_API_KEY=<…>` |
| Copilot | Driven by VSCode's GitHub auth session — switch via `Sign out` / `Sign in` flow; we surface a deep link |
| Cursor | Cursor auth lives in `state.vscdb`; cannot be safely switched without restart. Documented as a limitation |

Profiles are bootstrapped automatically on first scan (one per discovered credential), and the user can rename / merge / delete them in a dedicated "Profiles" view.

### 10.3 Same user across multiple machines

Distinct from §10.1/10.2 (multi-account on one machine) and §16 OQ3 (data dir happens to be synced). This is the case where one person uses, e.g., a work Mac and a home Linux laptop with the **same** Anthropic / OpenAI / Google account on both.

**Default behavior (no setup required)**

- Each machine has its own VSCode `globalStorage` → its own SQLite → reflects only locally-collected events.
- For **providers with usage APIs** (Anthropic Admin API, OpenAI Usage API, GitHub Copilot billing), the cross-machine number is already correct: the API returns server-aggregated totals, so the dashboard on either machine shows the same authoritative org-wide value once the user opts into the Admin/Usage integration. **No sync needed for plan-quota.**
- For **Pro/Max/Plus plans (no usage API)**, each machine's local-token-sum is a partial view of the user's true spend, and user-configured caps apply per-machine. **Documented limitation; see opt-in paths below.**

**Three opt-in paths for a unified cross-machine local view**

1. **Sync the agent data dirs.** User configures Syncthing / Dropbox / iCloud / OneDrive to mirror `~/.claude`, `~/.codex`, `~/.gemini` between machines. The §16 OQ3 dedupe + tolerant-parser handling then naturally produces the unified view on each machine. *Cleanest option for users already comfortable with file sync. This is the recommended path in the README.*

2. **Export / Import** via command palette: `Coding Agent Monitor: Export Usage` → JSON file (events + profiles + collector_state); `Coding Agent Monitor: Import Usage` → reads JSON and inserts via `INSERT OR IGNORE`, so re-imports are idempotent. Manual but requires zero infra. Good for occasional reconciliation or migrating to a new machine.

3. **Sync hub (v2, deferred).** User points the extension at a self-hosted tiny relay (URL configurable via setting + secret in `SecretStorage`). Extensions push compacted event batches and pull on refresh. Privacy-preserving because the user owns the endpoint — extension never talks to an Anthropic-controlled server. Out of scope for v1.

**Explicitly NOT supported**

- **Putting the SQLite store in a synced folder** (e.g., overriding `globalStorage` to a Dropbox path). SQLite + cloud-sync clients = file corruption, particularly with WAL/SHM sidecar files. On startup the extension detects whether its `globalStorage` path lives under a known sync root (using the §16 OQ3 marker logic) and refuses to start, logging a `collector_issues` row with kind=`permission` and a fix-it message pointing to path 1 above.

### 10.4 Agent invocation & graphify integration (v1: path A + G1)

The extension does **not** embed agent chat UIs in v1. The "single pane of glass" is for *visibility* (monitor) and *launch* (profile-aware terminal spawn). Native chat continues to happen in each agent's own UI. v2 may add embedded chat (see §18 future scope).

**Launch flow**

`Coding Agent Monitor: Launch Agent…` (command palette + sidebar button) → quick-pick: agent → profile → model → workspace. The extension then opens a new VSCode integrated terminal with the right `cwd`, env vars (per §10.2 recipe), and CLI flags, and runs the agent. The terminal title is labeled `claude (work-email · sonnet-4-6)` so sessions are visually distinct.

**Graphify wiring (path G1 — sidecar)**

[graphify](https://github.com/safishamsi/graphify) is an external code-knowledge-graph indexer (tree-sitter AST parsing, Leiden community detection) that exposes an MCP server with `query_graph`, `get_node`, `shortest_path` tools. Our extension auto-configures each launched agent to use it, so agents query the graph instead of grep-walking the codebase — that's where the token savings come from.

- **Detection.** On extension activation, check for `graphify` on `PATH` and for a `.graphify/` directory in the open workspace. State is one of: `not-installed`, `installed-not-indexed`, `installed-indexed-fresh`, `installed-indexed-stale` (last rebuild older than newest git HEAD).
- **Sidebar surface.** A "Graph context" card under the per-provider cards shows current state, last rebuild time, node/edge counts, and contextual buttons:
  - `not-installed` → "Install graphify" link to upstream README
  - `installed-not-indexed` → "Build graph" → runs `graphify .` in a terminal
  - `installed-indexed-stale` → "Rebuild graph" + offer to install graphify's git post-commit hook
  - `installed-indexed-fresh` → green check + summary
- **MCP wiring on launch.** When the user invokes "Launch Agent…", if graphify is `installed-indexed-*`, the extension injects an MCP server entry per the launched agent's config conventions:
  - **Claude Code:** `--mcp-config <tempfile>` flag pointing at `{ "mcpServers": { "graphify": { "command": "graphify", "args": ["serve"] } } }`
  - **Codex CLI:** writes `[mcp_servers.graphify]` to a temp `config.toml` in a temp `CODEX_HOME`
  - **Gemini CLI:** writes `mcpServers.graphify` to a temp settings file referenced via Gemini's config-dir env var
  - **Copilot / Cursor:** no programmable MCP config — the sidebar shows a one-time copy-paste snippet for the user to add to the relevant settings file
- **Token-savings telemetry.** When the §6.6.a tool-use facet sees `mcp__graphify__*` calls in a session, the dashboard surfaces an inline note on that session's row: "Used graph context (N queries)." We don't claim a token-saving number — that's a counterfactual we can't measure honestly. Query count is a directional proxy users can interpret.

**What we explicitly don't do in v1**

- Embed chat for any agent in our webview (paths B/C/D from the design conversation).
- Reimplement graphify's indexer (path G2). We're a consumer.
- Inject context into the agents' prompts ourselves. Agents control their own context window. We only configure the MCP tools available to them; the agent decides whether to call them. This keeps us out of the agents' prompt path and out of their compatibility envelope.

---

## 11. Privacy & Security

- **No outbound telemetry.** Period. Extension manifest declares zero `network` capability beyond explicit user actions (pricing update, optional Admin API calls).
- **Admin API keys** (Anthropic / OpenAI) stored exclusively in VSCode's `SecretStorage`, never in `settings.json`.
- **Reading credential files** (`.credentials.json` etc.) is read-only and only to extract email / config-dir paths. We never copy the bearer tokens themselves into our SQLite.
- **Custom agent plugins** (TS) — disabled by default; loading prompts a one-time consent dialog with the plugin's source path.
- **`raw_meta`** column scrubs known sensitive fields (auth headers, API keys) before storage.

---

## 12. Cross-Platform Support

| Path concept | macOS | Linux | Windows |
|---|---|---|---|
| Claude Code home | `~/.claude` | `~/.claude` | `%USERPROFILE%\.claude` |
| Codex home | `~/.codex` | `~/.codex` | `%USERPROFILE%\.codex` |
| Gemini home | `~/.gemini` | `~/.gemini` | `%USERPROFILE%\.gemini` |
| VSCode globalStorage | `~/Library/Application Support/Code/User/globalStorage` | `~/.config/Code/User/globalStorage` | `%APPDATA%\Code\User\globalStorage` |
| Cursor data | `~/Library/Application Support/Cursor` | `~/.config/Cursor` | `%APPDATA%\Cursor` |

All path resolution centralized in `src/platform/paths.ts`.

---

## 13. Project Layout

```
coding-agent-monitor/
├── DESIGN.md                       # this file
├── README.md
├── package.json                    # VSCode extension manifest
├── tsconfig.json
├── assets/
│   ├── pricing.json
│   └── icons/
├── src/
│   ├── extension.ts                # activate / deactivate
│   ├── platform/
│   │   └── paths.ts
│   ├── store/
│   │   ├── db.ts                   # better-sqlite3 setup, migrations
│   │   └── queries.ts              # aggregation queries
│   ├── collectors/
│   │   ├── types.ts                # UsageCollector, UsageEvent
│   │   ├── manager.ts              # discovery, scheduling
│   │   ├── jsonlReader.ts          # shared incremental JSONL tail
│   │   ├── claudeCode.ts
│   │   ├── codex.ts
│   │   ├── gemini.ts
│   │   ├── copilot.ts
│   │   ├── cursor.ts               # stub + experimental SQLite poker
│   │   ├── mcp.ts                  # MCP server discovery + tool-use facet
│   │   └── custom.ts               # manifest + (gated) TS plugin loader
│   ├── pricing/
│   │   ├── table.ts                # load + lookup
│   │   └── updater.ts              # opt-in pricing refresh
│   ├── profile/
│   │   ├── registry.ts
│   │   └── launcher.ts
│   ├── ui/
│   │   ├── statusBar.ts
│   │   ├── sidebarProvider.ts      # WebviewViewProvider
│   │   └── webview/                # built artifact for sidebar UI
│   ├── webview-src/                # source for the webview (preact + vite)
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── main.tsx
│   └── commands/
│       ├── launchAgent.ts
│       ├── setQuotas.ts
│       ├── addCustomAgent.ts
│       ├── updatePricing.ts
│       └── exportCsv.ts
├── test/
│   ├── fixtures/                   # captured sample session files per agent
│   └── collectors/
└── .github/workflows/ci.yml
```

---

## 14. Build / Distribution

- **Extension host bundler:** `esbuild` (fast, single-file output for the activation entry point).
- **Webview stack:** **React 18 + Vite + Tailwind CSS**. Component primitives via `shadcn/ui` (copy-in, no runtime dep). Charts via `recharts`. Rationale: most-readable code, largest community, easiest to iterate on with AI assistance. Bundle size is irrelevant in a sidebar webview.
- **SQLite:** `better-sqlite3` (native). Prebuilt binaries fetched per VSCode Electron version using `@vscode/electron-rebuild` during `npm run build`. CI matrix builds for darwin-arm64 / darwin-x64 / linux-x64 / win32-x64.
- **Test runner:** `vitest` for unit tests against fixtures captured from each agent's real session files.
- **Lint/format:** `eslint` (typescript-eslint) + `prettier`.
- **CI:** GitHub Actions — lint, type-check, test, package VSIX on tags.
- **Distribution:** VSCode Marketplace + Open VSX. Initial release private (`.vsix`-only) until v0.2.

---

## 15. Phased Implementation within v1

Even with "all agents day 1," internal phasing reduces blast radius:

1. **Skeleton** — extension scaffold (React+Vite+Tailwind webview, esbuild host, `better-sqlite3` store), sidebar with empty state, status bar item, command palette skeletons.
2. **Claude Code collector** — full E2E (parse → store → render). Validates the architecture.
3. **Codex collector + Gemini collector** — pattern repeats; refactor common code into `collectors/jsonlReader.ts`.
4. **MCP tool-use facet** (§6.6.a) — extend the three JSONL collectors to extract `mcp__*` tool-use blocks into `raw_meta.tool_calls`; add MCP breakdown card to sidebar.
5. **Copilot collector** — different shape (GitHub API rather than logs). Validates the abstraction holds.
6. **Profile model + tagging across all providers.**
7. **Cursor collector** — stub by default, experimental SQLite read behind setting flag.
8. **MCP standalone-server collector** (§6.6.b) — config discovery + manifest-based log parsing.
9. **Custom-agent plugin loader** — manifest first; TS plugins gated behind explicit consent.
10. **Active profile switching** (`buildLaunchSpec`) + **Launch Agent…** quick-pick command.
11. **Graphify integration** (§10.4) — detection, sidebar Graph Context card, per-agent MCP config injection on launch.
12. **Quota caps + status-bar warning levels** + **Issues tab** (§OQ6).
13. **Pricing updater + Export/Import (CSV + JSON, §10.3) + sync-root detection (§OQ3).**
14. **Polish, packaging, README, marketplace listing.**

---

## 16. Open Questions / Risks

- **OQ1** ~~SQLite native vs pure-JS~~ → **Resolved:** `better-sqlite3` (native), built per-platform in CI via `@vscode/electron-rebuild`.
- **OQ2** ~~Webview framework~~ → **Resolved:** React 18 + Vite + Tailwind + shadcn/ui + recharts.
- **OQ3** ~~Multi-machine synced log dirs~~ → **Resolved:** the issue is cross-machine sync of an agent's data dir generally (iCloud/Dropbox/OneDrive/Syncthing/Nextcloud — works the same across macOS/Linux/Windows). Three-part handling, all OS-agnostic:
  1. **Dedupe by event `id` hash** (`hash(provider, profile_id, session_id, message_index)`) on insert — same JSONL file parsed on two machines produces identical ids, so the second insert is a no-op.
  2. **Tolerant JSONL parsing** — sync clients can copy a file mid-write, producing truncated final lines. Parser must buffer the trailing partial line and retry on next poll instead of crashing. Needed regardless of sync, but especially here.
  3. **Synced-dir detection** at startup — walk up from each agent's data dir looking for sync markers and surface a one-time dismissable banner if found:
     - `.dropbox/`, `.dropbox.cache/` (Dropbox)
     - `*.icloud` placeholder files or `com.apple.fileproviderd` xattrs (iCloud Drive, macOS or Windows)
     - `desktop.ini` containing `OneDrive` (Windows OneDrive) or `~/Library/CloudStorage/OneDrive-*/` ancestor (macOS)
     - `.stfolder`, `.stignore` (Syncthing — all OSes)
     - `.nextcloudsync.log` (Nextcloud)
     - Banner copy: "`~/.claude` appears to be synced across machines — totals shown reflect all synced sessions, not just this machine."
  4. **Per-machine SQLite store** is unchanged (each machine maintains its own aggregated view; no DB merging required).
- **OQ4** ~~Cursor stub vs. local read~~ → **Resolved:** hybrid — stub default, opt-in experimental SQLite read with schema fingerprinting.
- **OQ5** ~~MCP server logs~~ → **Resolved:** in scope for v1. Two-flow design (§6.6.a tool-use facet, §6.6.b standalone-server collector).
- **OQ6** ~~Collector-error UX~~ → **Resolved:** dedicated **Issues** tab in the sidebar + a colored dot on the status-bar item whenever `unresolved_issues > 0`. Issues tab lists each failure with: collector id, timestamp, error class (parse error / schema mismatch / network / permission), short message, "open log" link. No notification toasts. Schema in `collector_issues(id, provider, ts, kind, message, source_path, resolved_at)`.
- **R1** Provider session-file formats change without notice. Mitigation: schema-version-tolerant parsers + comprehensive fixture-based regression tests + a "format mismatch" warning surface.
- **R2** Native module (`better-sqlite3`) breakage on VSCode Electron upgrades. Mitigation: pin via `@vscode/electron-rebuild`, watch upstream release notes, have a known-good rebuild step in CI.
- **R3** Custom-agent plugin sandbox escapes. Mitigation: TS plugins disabled by default; declarative manifest format covers the common case without code execution.
- **R4** MCP-server `mcp__*` naming convention drift — if Anthropic changes how MCP tools are namespaced, the §6.6.a parser breaks silently. Mitigation: fixture-based test that fails loudly on unrecognized tool-use blocks.

---

## 17. Edge Cases

These don't fit cleanly under the per-provider sections but materially affect correctness or UX. Each lists the case, the symptom if ignored, and the handling.

### Time & calendar
- **TZ for "today" boundary.** Events stored as UTC unix-ms. All bucketing into Today / Week / Month happens in the user's local TZ at query time. **Symptom if ignored:** rolled-over midnight events show up in the wrong day in the dashboard.
- **DST transitions.** Use `Intl.DateTimeFormat` with the local TZ for bucket boundaries — never raw `+24h` arithmetic.
- **Clock skew across machines** (relevant under §10.3 sync paths). Two machines with different clocks can produce out-of-order events. Sort on insert and ignore "future" events more than 5 min ahead of local clock; surface as a `collector_issues` row of kind=`other`.

### Concurrency & lifecycle
- **Multiple VSCode windows running the extension simultaneously** all share the same `globalStorage` SQLite. Mitigation: enable `journal_mode=WAL` on `better-sqlite3`, treat one window's collector as the writer (file lock under `${globalStorageUri}/.collector.lock`), other windows read-only. Lock auto-expires after 60s of staleness.
- **VSCode Remote (SSH / WSL / devcontainer).** Extension runs on the remote host — the data dirs it sees are remote dirs, not the user's local machine. Status bar and dashboard explicitly label the source: "Remote: ssh://hostname". When the user opens a local window, they get the local view. Each is correct in its scope; cross-machine merging happens via §10.3 paths.
- **Extension deactivation mid-collect.** Persist parser progress to `collector_state.byte_offset` *after* every batch insert, not at the end of the run. On reactivate, resume from the last persisted offset.

### Models & pricing
- **Bedrock / Vertex / LiteLLM proxies.** Same logical model under different model-id strings (`anthropic.claude-sonnet-4-6:0` via Bedrock, `claude-sonnet-4-6` direct, etc.). Pricing table includes an `aliases` map; provider field on the event reflects the *route* (`'claude-code-bedrock'`), not just the underlying model.
- **Local models (Ollama, llama.cpp).** Cost is $0; we still record token counts. Pricing table has an explicit `"free": true` flag for local model ids.
- **Unknown models.** Models the table doesn't know about (released yesterday) → `cost_usd = null`. UI shows "No pricing data" badge and links to a one-click "submit to pricing.json" GitHub PR helper.
- **Mid-period pricing changes.** Historical events retain their original computed cost. A `Recompute Historical Costs` command exists but is explicit and warned ("this changes past totals").

### Storage & data integrity
- **SQLite schema migrations.** Migrations table from day one (`schema_migrations(version, applied_at)`). Migrations are atomic, forward-only, idempotent. Extension refuses to start if it sees a `schema_migrations.version` newer than its bundled migration set (downgrade-safe).
- **Huge session files.** Some Claude Code sessions exceed 50 MB. Parser must stream line-by-line (`createReadStream` + line-buffer), never `readFileSync` the whole file. Memory cap: 64 MB resident per collector run.
- **Truncated trailing JSON line.** Already covered (§16 OQ3 part 2). Buffer the partial tail line, retry on next poll.
- **Retention/rollup boundary.** When the daily-rollup job runs, it must not race with a collector mid-write. Rollups run in a transaction with a write lock; collectors back off for at most one cycle.

### Auth & profiles
- **Anonymous / no-credential sessions.** Some agents have free trial modes with no account. Profile becomes a synthetic `${provider}-anonymous` row, distinct from named profiles.
- **Account-id stability vs. email changes.** Profile primary key is `account_id` when the provider exposes one (Anthropic OAuth `sub`, OpenAI `org_id`/`user_id`, GitHub login). `email` is a label that can change without breaking event continuity.
- **Account switch mid-session-file.** A single JSONL containing turns from two accounts (rare but possible if the user re-auths mid-session) → events are tagged with the account active at parse time, with a `raw_meta.account_switch_in_session = true` flag for forensic clarity.

### Network & external APIs
- **Admin API rate limits.** Anthropic Admin / OpenAI Usage / GitHub API all rate-limit. Use exponential backoff with jitter; cache responses for at least 60 s; never block the UI thread on a network call.
- **Admin API auth failures.** Don't crash; surface as `collector_issues` kind=`network`, disable that integration until the user re-confirms credentials.

### Security & trust
- **Workspace trust.** Custom-agent TS plugins (§6.7) are not loaded in untrusted workspaces. Manifest-based custom agents *are* allowed since they don't execute code, only describe paths/fields.
- **Credential file readability.** If `~/.claude/.credentials.json` is mode 0600 and we can't read it (running as a different user under sudo, etc.), gracefully fall back to anonymous profile rather than crashing.

### Numeric edge cases
- **Zero-token responses.** Provider occasionally returns `{input_tokens: 0, output_tokens: 0}` for canceled requests. Don't divide-by-zero in cache-hit-percent computation; render "—" instead.
- **Sub-cent costs.** Store full precision (`REAL`), display rounded to 4 decimals at low magnitudes (`$0.0023`) and 2 at higher (`$4.20`).

---

## 18. What's Decided vs. What's Open

**Decided**
- **Provider coverage in v1:** Claude Code, Codex CLI, Gemini CLI, GitHub Copilot, Cursor (hybrid), MCP servers (two flows), custom plugins.
- **Storage:** `better-sqlite3` (native), prebuilt per-platform in CI.
- **Webview stack:** React 18 + Vite + Tailwind + shadcn/ui + recharts.
- **Cursor approach:** stub by default, opt-in experimental local SQLite read with schema fingerprinting.
- **MCP approach:** §6.6.a tool-use facet (parsed from host JSONLs, no new collection) + §6.6.b standalone-server collector (config discovery + manifest-based parsing).
- **Profile model:** tagging is always-on; active switching is opt-in via env-var-based launching, never by rewriting credential files.
- **Pricing:** local table shipped in VSIX, refreshable by explicit user command.
- **Privacy:** zero outbound telemetry; admin keys in `SecretStorage`; no dashboard scraping.

**Decided (continued)**
- **Synced data dir handling (§OQ3):** dedupe by event-id hash + tolerant JSONL parsing + cross-platform synced-dir detection banner. Per-machine SQLite stores remain isolated.
- **Collector-error UX (§OQ6):** Issues tab in sidebar + status-bar dot when `unresolved_issues > 0`. No notification toasts. New `collector_issues` table.
- **Same user, multiple machines (§10.3):** default = local view per machine + server-aggregated quota for API-backed providers. Three opt-in paths for unified local view: sync the agent data dirs (recommended), Export/Import JSON commands (manual), self-hosted Sync Hub (deferred to v2). Refuse to run if `globalStorage` is on a sync-root.
- **Agent invocation (§10.4):** v1 = path A (deep-link / launch in terminal under chosen profile). No embedded chat in v1. Embedded chat (path B) deferred to v2.
- **Graphify (§10.4):** v1 = path G1 (sidecar + per-agent MCP wiring on launch). Graphify is an external dependency the user installs; we detect, surface state in sidebar, and auto-inject MCP config when launching agents that support it. Token-savings shown as graph-query count, not a fabricated $-saved number.

**Future scope (v2+, not committed)**
- Embedded chat for agents in our webview (path B from the design conversation).
- Self-hosted Sync Hub for cross-machine real-time view.
- MCP server log scanning beyond the §6.6 manifest path.

**Still open**
- Any user stories I missed.

**Ready to scaffold?** Once you've skimmed §6.5–6.6 and §17, the next step is phase 1 from §15: extension scaffold (host + webview + store + status bar + sidebar empty state). I'll wait for your go-ahead before touching code.
