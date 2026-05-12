import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startOfTodayMs, todayDateParts } from '../time.js';
import { costFor, loadPricing, type TokenCounts } from '../pricing.js';
import {
  emptyWindow,
  type AgentSnapshot,
  type Provider,
  type StatusContext,
  type UsageWindow,
} from './types.js';

interface CodexLine {
  timestamp?: string;
  payload?: {
    type?: string;
    info?: {
      total_token_usage?: CodexCumUsage;
      last_token_usage?: CodexCumUsage;
    };
    model?: string;
  };
  type?: string;
}

interface CodexCumUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function codexHome(): string {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.length > 0) return process.env.CODEX_HOME;
  return join(homedir(), '.codex');
}

export class CodexProvider implements Provider {
  readonly name = 'codex' as const;

  async snapshot(_ctx: StatusContext): Promise<AgentSnapshot> {
    const { year, month, day } = todayDateParts();
    const dayDir = join(codexHome(), 'sessions', year, month, day);
    let entries: string[];
    try {
      entries = await readdir(dayDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { agent: this.name, today: emptyWindow() };
      }
      throw err;
    }

    const rolloutFiles = entries.filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
    if (rolloutFiles.length === 0) return { agent: this.name, today: emptyWindow() };

    const pricing = await loadPricing();
    const todayStart = startOfTodayMs();

    const todayByModel = new Map<string, TokenCounts>();
    let latestMtime = 0;
    let latestFile: string | null = null;
    let latestPerSession: { tokens: TokenCounts; model: string } | null = null;

    for (const f of rolloutFiles) {
      const path = join(dayDir, f);
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        continue;
      }
      if (mtimeMs > latestMtime) {
        latestMtime = mtimeMs;
        latestFile = path;
      }
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        continue;
      }

      const sessionTotals = parseRollout(raw, todayStart);
      for (const [model, t] of sessionTotals.byModel) {
        mergeInto(todayByModel, model, t);
      }
      if (path === latestFile && sessionTotals.dominantModel) {
        latestPerSession = {
          tokens: sessionTotals.byModel.get(sessionTotals.dominantModel) ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          model: sessionTotals.dominantModel,
        };
      }
    }

    // We may have updated latestFile mid-loop. Re-derive session window for the actual latest file.
    if (latestFile !== null) {
      try {
        const raw = await readFile(latestFile, 'utf8');
        const totals = parseRollout(raw, todayStart);
        if (totals.dominantModel) {
          latestPerSession = {
            tokens: totals.byModel.get(totals.dominantModel)!,
            model: totals.dominantModel,
          };
        }
      } catch {
        // ignore
      }
    }

    const today = aggregateWindow(todayByModel, pricing);
    const snapshot: AgentSnapshot = { agent: this.name, today };
    if (latestPerSession) {
      const sessionWindow = emptyWindow();
      sessionWindow.inputTokens = latestPerSession.tokens.input;
      sessionWindow.outputTokens = latestPerSession.tokens.output;
      sessionWindow.cacheReadTokens = latestPerSession.tokens.cacheRead ?? 0;
      sessionWindow.cacheWriteTokens = latestPerSession.tokens.cacheWrite ?? 0;
      sessionWindow.primaryModel = latestPerSession.model;
      sessionWindow.costUsd = costFor(pricing, latestPerSession.model, latestPerSession.tokens);
      snapshot.session = sessionWindow;
    }
    return snapshot;
  }
}

interface RolloutTotals {
  byModel: Map<string, TokenCounts>;
  dominantModel?: string;
}

/**
 * Codex token_count events carry CUMULATIVE totals per session, so per-turn deltas
 * are computed by diffing against the previous token_count line. The current
 * model for a turn comes from the most recent turn_context event.
 */
function parseRollout(raw: string, todayStart: number): RolloutTotals {
  const lines = raw.split('\n');
  let prev: CodexCumUsage = {};
  let currentModel = 'unknown';
  const byModel = new Map<string, TokenCounts>();
  const dominanceCount = new Map<string, number>();

  for (const line of lines) {
    if (!line) continue;
    let evt: CodexLine;
    try {
      evt = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }
    const payloadType = evt.payload?.type ?? evt.type;
    if (payloadType === 'turn_context' && evt.payload?.model) {
      currentModel = evt.payload.model;
    }
    if (payloadType !== 'token_count') continue;
    const cum = evt.payload?.info?.total_token_usage;
    if (!cum) continue;
    const ts = evt.timestamp ? Date.parse(evt.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < todayStart) {
      prev = cum;
      continue;
    }
    const delta: TokenCounts = {
      input: nonNegDelta(cum.input_tokens, prev.input_tokens),
      output: nonNegDelta(cum.output_tokens, prev.output_tokens),
      cacheRead: nonNegDelta(cum.cached_input_tokens, prev.cached_input_tokens),
      cacheWrite: 0,
    };
    prev = cum;
    if (delta.input + delta.output + (delta.cacheRead ?? 0) === 0) continue;
    mergeInto(byModel, currentModel, delta);
    dominanceCount.set(currentModel, (dominanceCount.get(currentModel) ?? 0) + 1);
  }

  let dominantModel: string | undefined;
  let topCount = 0;
  for (const [m, c] of dominanceCount) {
    if (c > topCount) {
      topCount = c;
      dominantModel = m;
    }
  }
  return { byModel, dominantModel };
}

function nonNegDelta(curr: number | undefined, prev: number | undefined): number {
  const c = curr ?? 0;
  const p = prev ?? 0;
  return Math.max(0, c - p);
}

function mergeInto(map: Map<string, TokenCounts>, model: string, t: TokenCounts): void {
  const cur = map.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  cur.input += t.input;
  cur.output += t.output;
  cur.cacheRead = (cur.cacheRead ?? 0) + (t.cacheRead ?? 0);
  cur.cacheWrite = (cur.cacheWrite ?? 0) + (t.cacheWrite ?? 0);
  map.set(model, cur);
}

function aggregateWindow(
  byModel: Map<string, TokenCounts>,
  pricing: Awaited<ReturnType<typeof loadPricing>>,
): UsageWindow {
  const win = emptyWindow();
  let topTokens = 0;
  for (const [model, t] of byModel) {
    win.inputTokens += t.input;
    win.outputTokens += t.output;
    win.cacheReadTokens += t.cacheRead ?? 0;
    win.cacheWriteTokens += t.cacheWrite ?? 0;
    win.costUsd += costFor(pricing, model, t);
    const modelTotal = t.input + t.output + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0);
    if (modelTotal > topTokens) {
      topTokens = modelTotal;
      win.primaryModel = model;
    }
  }
  return win;
}
