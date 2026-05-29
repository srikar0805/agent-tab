# agent-tab — Design

A short-lived Node CLI that prints today's token usage and cost for the active AI coding agent (Claude Code, Codex CLI, or Gemini CLI). Designed to slot into Claude Code's `statusLine` so the number sits right above your prompt.

```
[claude] session $0.08 · today $0.42 · 12.3k tok · claude-sonnet-4-6
```

User-facing docs live in [README.md](./README.md). This file is for engineers and reviewers.

---

## 1. Overview

`agent-tab` exists because token bills for AI coding agents are easy to lose track of when you use more than one — three CLIs, three dashboards, three accounts, no single place to look. The agents already write their session data to local disk; `agent-tab` reads those files, applies a local pricing table, and prints the result wherever you'd see it: above the prompt in Claude Code, or on demand in any terminal.

The whole thing is one process, one file read pass, one stdout write, and exit. No daemon, no database, no telemetry server, no IPC.

---

## 2. Goals & Non-Goals

### Goals
- **G1.** Print today's per-agent cost and tokens in **under 100ms** on a typical day's logs.
- **G2.** Three providers in v1: Claude Code, Codex CLI, Gemini CLI — each parsed from its native on-disk format.
- **G3.** Plug into Claude Code's `statusLine` as a drop-in command, so the number is *always* visible without the user opening anything.
- **G4.** Honest cost numbers — `$?` when pricing is unknown, never a misleading `$0.00`.
- **G5.** No outbound network from the status path. The one optional outbound (model-pricing fetch) is fire-and-forget, opt-out via flag/env, and carries no usage data.
- **G6.** Zero runtime dependencies. Pure-TS source, compiled with `tsc`, distributed as a tiny npm package.

### Non-Goals
- **NG1.** No daemon, no continuous polling, no SQLite, no cross-invocation cache of usage data. The CLI is short-lived by design.
- **NG2.** No history beyond "today." Week/month/year aggregation can be layered on later — the upstream JSONLs are still on disk.
- **NG3.** No GitHub Copilot, Cursor, or custom agents in v1. Copilot's only metering is the GitHub billing API (network + OAuth); Cursor's local store is undocumented and version-fragile. Both gated for future opt-in.
- **NG4.** No multi-agent aggregation in the output line. One active agent at a time. Aggregation is a separate UX problem belonging in a separate command (`agent-tab summary`, future).
- **NG5.** No GUI. A previous direction (VSCode extension with sidebar webview) was abandoned because (a) Claude Code's `statusLine` is a first-class hook that matches the real user need better, and (b) a one-shot CLI has no Electron-ABI / native-module / lifecycle footguns.

---

## 3. Architecture

```
Claude Code statusLine refresh
   │ stdin: { session_id, transcript_path, workspace: { current_dir, … } }
   ▼
agent-tab (Node process, ~50ms)
   │
   ├─ parse argv (cli.ts)
   ├─ read stdin JSON if piped (200ms timeout, optional)
   ├─ readConfig() → activeAgent: claude | codex | gemini
   ├─ maybeTriggerBackgroundRefresh()  ─┐  (detached child, returns instantly)
   │                                    └→ fetches models.dev catalog if stale
   ├─ getProvider(activeAgent).snapshot(ctx)
   │     │
   │     ├─ claude  → walk ~/.claude/projects/*/*.jsonl
   │     ├─ codex   → walk ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
   │     └─ gemini  → read ~/.gemini/telemetry.log
   │
   ├─ pricing.costFor(model, tokens)  ←  cache (models.dev) ⊕ bundled (assets/pricing.json)
   └─ formatSnapshot(snap) → stdout (single line, ANSI unless NO_COLOR)
```

Three distinct paths through `runStatus`:
1. **Fast path (typical):** logs read, totals summed, line emitted. <100ms.
2. **Cold path (first run / stale pricing):** identical to fast path *plus* a `spawn().unref()` of a detached `agent-tab update-pricing` process. Status path doesn't wait.
3. **Failure path:** any error inside `snapshot()` is caught and emitted as `[agent] error: <msg>` with exit code 0 — never crash the statusLine.

---

## 4. CLI Surface

| Invocation | Behavior |
|---|---|
| `agent-tab` *(no args)* | Reads optional stdin JSON; prints active agent's usage line; exits 0. This is the form Claude Code calls. |
| `agent-tab status [flags]` | Identical, with one-shot overrides. |
| `agent-tab use <claude\|codex\|gemini>` | Persistently sets the active agent in `$XDG_CONFIG_HOME/agent-tab/config.json`. |
| `agent-tab show` | Prints the active agent name to stdout. |
| `agent-tab update-pricing` | Synchronously fetches `https://models.dev/api.json` and writes the cache. |
| `agent-tab --help` / `-h` | Usage text. |
| `agent-tab --version` / `-v` | Version string. |

### Flags for `status`

| Flag / env | Effect |
|---|---|
| `--provider=<agent>` | One-shot override of the active agent (does not persist). |
| `--no-color` / `--color` | Force ANSI on/off. |
| `--offline` *or* `AGENT_TAB_OFFLINE=1` | Skip the background pricing-cache refresh trigger. |
| `NO_COLOR` *(env)* | Honored; disables color by default. |
| `FORCE_COLOR` *(env)* | Honored; enables color by default. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Normal output written (including the *graceful-error* form `[agent] error: …`). |
| `1` | Unrecoverable error (e.g., `update-pricing` couldn't reach models.dev in foreground mode). |
| `2` | Usage error (unknown subcommand, bad `--provider` value, missing `use` argument). |

`status` deliberately never exits non-zero. Reason: a non-zero exit from a `statusLine` command makes Claude Code hide the status line. We'd rather show an error than disappear.

---

## 5. Output Format

The output is a single line, designed to be readable inline above a prompt.

```
[claude] session $0.08 · today $0.42 · 12.3k tok · claude-sonnet-4-6
```

### Anatomy

- `[claude]` — dim brackets with the agent name colored cyan.
- `session $X.XX` — present iff the snapshot has a `session` window (Claude Code transcript matches stdin, or Codex's most-recent session today).
- `today $X.XX` — always present; cost since local midnight, across all sessions of the active agent.
- `12.3k tok` — sum of input + output + cache_read + cache_write tokens for today, dim text.
- `claude-sonnet-4-6` — primary model for the day, chosen as the model with the most tokens. Dim text.

### Special cost rendering

| Window state | Rendered as |
|---|---|
| `costUsd === 0`, all models priced | `$0.00` |
| `0 < costUsd < 0.01`, all priced | `$X.XXXX` (4 decimal places) |
| `costUsd ≥ 0.01`, all priced | `$X.XX` |
| `costUsd === 0`, **any model unpriced** | `$?` |
| `costUsd > 0`, **any model unpriced** | `$X.XX+?` |

The `+?` form is the design's honest answer to: *some* models in the window have pricing, *some* don't; we show what we know and flag that the total is partial. A naive `$0.00` for an unpriced model would look indistinguishable from "no activity," which is dangerous.

### Warning form

When a provider returns `warning: <message>`, the line collapses to:

```
[gemini] telemetry not enabled — set telemetry.target = "local" in ~/.gemini/settings.json
```

This is intentionally distinct from the normal form so it stands out.

### Color rules

- `cyan` — agent name.
- `bold` — cost values (the thing the user is here to see).
- `dim` — separators (`·`), brackets, secondary info (`tok`, model name).
- `yellow` — warning text.
- Color off when `NO_COLOR` is set OR `--no-color` OR `stdout` is not a TTY (the `colorEnabledByDefault()` function in `format.ts` makes the call).

---

## 6. Per-Provider Data Extraction

Each provider implements:

```ts
interface Provider {
  readonly name: AgentName;                          // 'claude' | 'codex' | 'gemini'
  snapshot(ctx: StatusContext): Promise<AgentSnapshot>;
}

interface StatusContext {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
}

interface AgentSnapshot {
  agent: AgentName;
  today: UsageWindow;
  session?: UsageWindow;
  warning?: string;
}

interface UsageWindow {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  primaryModel?: string;
  unknownPricing?: boolean;
}
```

### 6.1 Claude Code (`providers/claude.ts`)

- **Source:** `~/.claude/projects/*/*.jsonl`. Honors `CLAUDE_CONFIG_DIR`.
- **Filter:** mtime ≥ start-of-today (cheap pre-filter to skip files that can't possibly contribute), then in-line `timestamp` (ISO 8601) ≥ start-of-today (authoritative — handles long-running sessions whose file mtime spans midnight).
- **Event of interest:** lines where `type === 'assistant'` and `message.usage` is present. Sums `input_tokens`, `output_tokens`, `cache_creation_input_tokens` (→ `cacheWrite`), `cache_read_input_tokens` (→ `cacheRead`).
- **Per-model aggregation:** accumulates tokens per model; the "primary model" for the day is the one with the most total tokens (input + output + cache).
- **Session scoping:** `ctx.transcriptPath` if provided, else `${ctx.sessionId}.jsonl` match. Both come from Claude Code's stdin JSON when invoked as a statusLine. Outside that context, `session` is omitted.
- **Tolerance:** `split('\n')` then drop a trailing empty element to handle a partial trailing line from a mid-write file. Unparseable JSON lines are skipped silently.

### 6.2 Codex CLI (`providers/codex.ts`)

- **Source:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Honors `CODEX_HOME`.
- **Event of interest:** `payload.type === 'token_count'`. Codex emits **cumulative** session totals here, not per-turn deltas — `agent-tab` diffs consecutive cumulative values to derive turn-level token counts, clamped at zero (in case of session resets).
- **Model attribution:** the most recent `payload.type === 'turn_context'` event's `model` field is the active model for subsequent token-count events until another `turn_context` overrides it. Defaults to `'unknown'`.
- **Session window:** most-recently-modified rollout file of the day (no `transcript_path` plumbing in this context, since `statusLine` fires from Claude Code).
- **Filter:** by date in directory path (YYYY/MM/DD); files outside today's directory aren't even opened.

### 6.3 Gemini CLI (`providers/gemini.ts`)

- **Source:** `~/.gemini/telemetry.log`. An OpenTelemetry-formatted text log. Honors `GEMINI_HOME`.
- **Required setup:** user must set `telemetry.target = "local"` in `~/.gemini/settings.json`. Without it the file doesn't exist.
- **Missing-file handling:** returns `{ today: emptyWindow(), warning: 'telemetry not enabled — …' }`. Returning zero would look the same as a real $0 day, which is misleading; the warning form is distinct.
- **Event of interest:** `gemini_cli.api_response`, with attributes `model`, `input_token_count`, `output_token_count`, `cached_content_token_count`, `session.id`.
- **Session window:** most-recent `session.id` of the day, similar to Codex.

### Why three different shapes

Each agent's native log format reflects different design priorities:
- Claude Code keeps a *full transcript* per session (everything is in the JSONL).
- Codex CLI keeps a session *rollout* with a separate cumulative token counter.
- Gemini CLI exposes everything via *OpenTelemetry*, conditional on user opt-in.

We don't try to unify the formats upstream — we keep one parser per provider and unify only the output (`AgentSnapshot`). That's a deliberate boundary: adding a new provider doesn't require touching others.

---

## 7. Active-Agent Model

A single, persistent, user-explicit choice — not auto-detected.

### Storage
`$XDG_CONFIG_HOME/agent-tab/config.json` (defaults to `~/.config/agent-tab/`). Schema:
```json
{ "activeAgent": "claude" }
```

### Why a persistent file, not an env var or auto-detect

- **Claude Code's statusLine is non-interactive.** It runs a shell command and reads stdout. There's no place for an in-band picker.
- **Auto-detect ambiguity.** If both Claude Code and Codex CLI ran today, which one are you currently focused on? No reliable signal from inside Claude Code's statusLine context to disambiguate. A persistent choice avoids that ambiguity entirely.
- **Easy to switch.** `agent-tab use codex` is a one-keystroke shell command. Faster than any UI picker.

### Default
`claude`. That's the only agent with a native statusLine; if a user installs `agent-tab` and immediately runs it through Claude Code, they see Claude Code's numbers, which matches expectation.

### Session-window fallback
When `--provider=codex` (or active-agent = codex) but the invocation is *inside* Claude Code's statusLine, `ctx.sessionId` and `ctx.transcriptPath` are Claude's — not Codex's. In that case the Codex provider falls back to "most-recent session of mine today" instead of attempting a cross-agent match. If neither matches, `session` is omitted from the output.

---

## 8. Pricing

### Two layers, layered

1. **`models.dev` cache** at `$XDG_CACHE_HOME/agent-tab/models.json` (default `~/.cache/agent-tab/`). Authoritative when present. Refreshed in the background — see §9.
2. **Bundled fallback** at [`assets/pricing.json`](assets/pricing.json), shipped inside the npm package. Used when the cache is missing or hasn't been populated yet.

### Lookup order
For a given `modelName`:
1. Exact match in the **cache**.
2. Cache match after stripping a trailing date suffix (e.g., `-20260101`) and then after stripping any trailing `-suffix`.
3. Exact match in **bundled**.
4. Bundled **alias** match (`models[].aliases[]` contains `modelName`).
5. Bundled **free-model** glob match (e.g., `ollama:*`, `llamacpp:*` → `{0, 0, 0, 0}`).

A miss returns `{ cost: 0, known: false }`. That bubbles up to `UsageWindow.unknownPricing = true`, and the formatter renders `$?` or `$X.XX+?` (§5).

### Why models.dev

A community-maintained per-model catalog with a stable JSON shape, keyed by provider then model id, with a `cost` block whose fields (`input`, `output`, `cache_read`, `cache_write`, per million tokens) map 1:1 to ours. Two practical wins:
- We don't have to PR new model pricing into the repo every time OpenAI / Anthropic / Google releases a model.
- The bundled fallback can stay tiny — it only needs to cover the most common current-generation models for the first-run-before-cache case.

### Why two layers

- **No internet on first run?** Cache absent → bundled fallback works.
- **Pricing changed yesterday?** Cache age > 24h → background refresh on next run, used from the run after.
- **User wants determinism?** `--offline` / `AGENT_TAB_OFFLINE=1` disables the refresh trigger. Pure-bundled mode.

### Privacy of the network call

The only outbound HTTP is `GET https://models.dev/api.json`. No usage data is sent. The fetch is spawned as a *detached* child process so the status path returns immediately regardless.

---

## 9. Performance Contract

`agent-tab` runs once per Claude Code statusLine refresh, and Claude Code debounces those at 300ms. **Per-invocation work must stay fast.**

### Latency budget

| Step | Budget | Notes |
|---|---|---|
| Node startup | ~25ms | Cold V8 init; can't shrink without going to a non-Node distribution. |
| `readConfig` | <2ms | One small JSON read. |
| `readStdinContext` | <205ms | 200ms timeout; typically resolves in <5ms when Claude Code is the caller. |
| Provider `snapshot` | <50ms | Dominated by JSONL parsing. mtime pre-filter keeps file count small. |
| `loadPricing` | <5ms | Bundled JSON in memory after first load; cache file is a one-shot read. |
| `formatSnapshot` + write | <1ms | String concat + one `write`. |
| **Total typical** | **<100ms** | Cold node startup is the biggest line item. |

### Allocations

The hot path is "many small JSON parses." We avoid:
- Reading whole-of-day file ranges (mtime pre-filter).
- Buffering more than one file in memory at a time.
- Reading non-JSONL files (extension check before `readFile`).

### When does it get slow

- **Users with hundreds of MB of today's Claude Code logs.** Unusual; would mean continuous use all day across many projects. If observed in the wild, fix is: track per-file byte offsets across invocations in a tiny cache file. Deferred — not currently needed.
- **Cold disk.** First read after boot can be slow. The detached background refresh and the mtime pre-filter help, but the OS pagecache is doing most of the work.

---

## 10. Reliability

### Never-crash-statusLine principle

Inside `runStatus`, the call to `getProvider(provider).snapshot(ctx)` is wrapped in `try`:
- On success → write the formatted line, exit 0.
- On any thrown error → write `[provider] error: <message>` to stdout, exit 0.

We exit 0 even on failure because Claude Code hides the statusLine when its command exits non-zero. A visible error message is more useful than a disappearing status.

The top-level `main()`'s catch is an even-deeper safety net (catches errors in argv parsing or the unhandled paths). It writes to stderr (Claude Code ignores stderr) and exits 1 — only relevant when not running under statusLine.

### Graceful degradation

| Failure | Behavior |
|---|---|
| Provider's data dir doesn't exist | Empty window, no error. |
| Single JSONL file is malformed | Skip that file; parse the rest. |
| Single line in a JSONL is malformed | Skip that line; parse the rest. |
| Gemini telemetry.log missing | `warning: telemetry not enabled — …` form. |
| models.dev cache file is corrupt | Fall back to bundled; trigger background refresh. |
| models.dev fetch fails (network down) | Status path doesn't care — it never blocked on it. Cache stays stale, bundled covers the case. |
| User config file is corrupt | `readConfig` parses what it can; defaults to `claude` if `activeAgent` invalid. |

---

## 11. Privacy & Security

- **All usage data stays local.** The CLI reads files under the user's home directory and prints to stdout. Nothing about which models were called, how many tokens, or which prompts ever leaves the machine.
- **Persistent state outside `$HOME`-managed paths:** none. The two files we write are both under XDG-conformant locations — `$XDG_CONFIG_HOME/agent-tab/config.json` (active-agent setting) and `$XDG_CACHE_HOME/agent-tab/models.json` (pricing catalog).
- **Stdin payload** from Claude Code (`session_id`, `transcript_path`, `workspace.current_dir`) is consumed in memory and never persisted.
- **One outbound HTTP request:** `GET https://models.dev/api.json` for the pricing catalog. No body, no headers other than what `fetch` adds by default. Disable with `--offline` or `AGENT_TAB_OFFLINE=1`.
- **No execution of foreign code.** No `eval`, no dynamic `require`, no plugin loader. Each provider is shipped TypeScript, compiled at build time.

---

## 12. Cross-Platform & Path Resolution

Env-var overrides, then XDG, then platform defaults:

| Concept | Order |
|---|---|
| Claude Code data dir | `$CLAUDE_CONFIG_DIR/projects` → `~/.claude/projects` |
| Codex data dir | `$CODEX_HOME` → `~/.codex` |
| Gemini data dir | `$GEMINI_HOME` → `~/.gemini` |
| Config | `$XDG_CONFIG_HOME/agent-tab/config.json` → `~/.config/agent-tab/config.json` |
| Pricing cache | `$XDG_CACHE_HOME/agent-tab/models.json` → `~/.cache/agent-tab/models.json` |

Windows path resolution falls out of Node's `os.homedir()` and `path.join`. Not yet exercised in CI; flagged as known-untested in §16.

---

## 13. Test Strategy

Vitest. **No fixture files on disk** — each test synthesizes its inputs.

Per-provider tests follow this shape:
1. `mkdtemp` a unique temp directory.
2. Set the provider's env override (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_HOME`) to point inside it.
3. Write a small number of fixture JSONL / telemetry-log lines covering: empty case, today event, pre-today event (must be excluded), session-scoped event, malformed line (must be skipped).
4. Call `provider.snapshot()`; assert against the returned `AgentSnapshot`.
5. Tear down the temp dir.

Pricing tests:
- `_resetPricingCache()` test helper between cases.
- Cover exact match, alias match, free-model glob, unknown model bubbling `unknownPricing`.
- models.dev cache layer tested by writing a fake cache file and asserting precedence over bundled.

Format tests:
- Cover the `$?`, `$X.XX+?`, color-on, color-off, warning, missing-session, present-session cases.

CLI is not tested via child-process spawn. The surface area is small and unit tests cover the underlying functions; adding a child-process harness gains little for the maintenance cost.

---

## 14. Project Layout

```
agent-tab/
├── DESIGN.md              this file
├── README.md              user-facing docs
├── LICENSE                MIT
├── package.json           Node CLI manifest, bin: agent-tab
├── tsconfig.json          NodeNext, ES2022 target
├── vitest.config.ts
├── assets/
│   └── pricing.json       bundled fallback pricing
├── src/
│   ├── cli.ts             argv router, stdin reader, statusLine entry
│   ├── config.ts          XDG-aware active-agent config persistence
│   ├── pricing.ts         layered lookup, costFor, glob matching
│   ├── modelsDev.ts       models.dev cache fetch + normalization
│   ├── format.ts          ANSI-aware single-line formatter
│   ├── time.ts            startOfTodayMs, todayDateParts (local TZ)
│   └── providers/
│       ├── types.ts       Provider, AgentSnapshot, UsageWindow, AgentName
│       ├── index.ts       registry; getProvider(name)
│       ├── claude.ts      ~/.claude/projects parser
│       ├── codex.ts       ~/.codex/sessions parser (cumulative-diff aware)
│       └── gemini.ts      ~/.gemini/telemetry.log parser
└── test/
    ├── config.test.ts
    ├── format.test.ts
    ├── modelsDev.test.ts
    ├── pricing.test.ts
    └── providers/
        ├── claude.test.ts
        ├── codex.test.ts
        └── gemini.test.ts
```

---

## 15. Build & Release

- **Build:** `tsc` only. No bundler, no transpilation step. Output is `dist/*.js` + `dist/*.d.ts`, ES modules with `.js` extensions in imports (NodeNext convention).
- **Entry point:** `dist/cli.js`, declared as `bin: { "agent-tab": "dist/cli.js" }` in `package.json`. The first line of `cli.ts` is `#!/usr/bin/env node` so it's directly executable after `npm link` / `npm install -g`.
- **Files published to npm:** `dist/`, `assets/pricing.json`, `README.md`, `LICENSE`. Source is in the repo but not the package.
- **CI** (`.github/workflows/`): typecheck + test on Node 20 + 22. Coverage report optional.
- **Release:** manual `npm version <bump> && npm publish` — pre-publish hook runs `npm run build`.

---

## 16. Roadmap

Ordered by user value × cost, not necessarily by date.

| Item | Why | Rough cost |
|---|---|---|
| Windows path resolution shakedown | We use `os.homedir()` + `path.join` everywhere, should work, but it's untested. | low |
| `agent-tab summary --window=week\|month` | Same parsers, different time window. The data's already on disk. | low |
| JSON output (`--json`) | For shell-prompt integrations (starship, etc.) that need machine-readable. | low |
| `agent-tab quota` opt-in plan-quota fetch | Network call, but opt-in matches privacy stance. Anthropic Admin API / OpenAI Usage API. | medium |
| Per-file byte-offset cache | Only if performance bites real users. Premature otherwise. | medium |
| Copilot provider | Different shape (GitHub billing API, premium-request metering, not raw tokens). | medium |
| Cursor provider | Best-effort SQLite read with schema fingerprinting + graceful degradation. | medium-high |
| Custom-agent manifest loader | JSON manifest declaring a log path + field mapping. Avoids needing a code plugin. | medium |

---

## 17. Open Questions

- **Does it make sense to surface the active agent's *plan-quota* (e.g., Claude Max usage) in the same line?** Would require a network call to provider APIs, which contradicts the "no network on the status path" promise. Probably belongs in a separate `agent-tab quota` command (opt-in, see roadmap).
- **Should `status` emit machine-readable JSON when stdout is not a TTY**, to support shell-prompt integrations cleanly? Currently it always emits the human line. Leaning toward an explicit `--json` flag rather than implicit TTY-based switching, to avoid surprising the user with mode changes.
- **Is "today" (local midnight to now) the right window?** "Past 24 hours" might be more useful around midnight rollovers, but "today" is what the user sees on every provider's dashboard, so cognitive consistency wins.
- **Should we expose a multi-agent line opt-in** (e.g., `agent-tab --all` printing all three on one line)? Conflicts with the "active agent only" simplicity. Probably belongs in a future `summary` command.

---

## 18. FAQ for Reviewers / Stakeholders

**Why a CLI, not a VSCode extension?** Earlier exploration prototyped the VSCode-extension direction. It was abandoned because (a) Claude Code's `statusLine` is a first-class hook that puts the number where the user actually looks (above the prompt), making a separate panel redundant; (b) a one-shot CLI has no native-module / Electron-ABI / extension-host lifecycle complications; (c) ships in one binary with zero runtime deps.

**Why not just use each provider's web dashboard?** Cognitive cost. Three dashboards, three logins, three accounts, refreshed on demand. The whole point is to make the number ambient.

**Why does this need to be its own product instead of a script?** The interesting work is in the provider parsers (Codex's cumulative-diff quirk; Claude's in-line timestamp vs file mtime distinction; Gemini's telemetry-opt-in dance) and the honest-cost formatting (`$?` / `$X.XX+?`). A 50-line shell script can't get those right.

**Could this be commercialized?** The current shape is MIT-licensed and free. A commercial extension could add: org-wide rollups behind an admin key, weekly digests via email, multi-machine sync, Cursor / Copilot / Codex enterprise support. Those features intentionally don't ship in the OSS CLI — they'd contradict the local-only / network-free stance the CLI promises.

**What's the failure mode if a provider changes its log format tomorrow?** Each provider parser is one file. Fixture-based tests in `test/providers/*.test.ts` lock in current behavior. A breaking format change shows up as a graceful empty result (mtime pre-filter still works) or a parse error (caught, line skipped). Either way the user sees stale numbers, not a crash. Then we fix the parser and ship.
