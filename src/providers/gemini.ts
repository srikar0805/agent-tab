import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startOfTodayMs } from '../time.js';
import { costFor, loadPricing, type TokenCounts } from '../pricing.js';
import {
  emptyWindow,
  type AgentSnapshot,
  type Provider,
  type StatusContext,
  type UsageWindow,
} from './types.js';

function geminiDir(): string {
  if (process.env.GEMINI_HOME && process.env.GEMINI_HOME.length > 0) {
    return process.env.GEMINI_HOME;
  }
  return join(homedir(), '.gemini');
}

function telemetryPath(): string {
  return join(geminiDir(), 'telemetry.log');
}

interface GeminiTelemetryRecord {
  // Best-effort shape — Gemini emits OpenTelemetry events; relevant ones contain these fields.
  name?: string;
  timestamp?: string;
  attributes?: {
    'event.name'?: string;
    model?: string;
    input_token_count?: number;
    output_token_count?: number;
    cached_content_token_count?: number;
    'session.id'?: string;
    [k: string]: unknown;
  };
}

const TELEMETRY_HELP =
  "telemetry not enabled — set telemetry.target='local' in ~/.gemini/settings.json";

export class GeminiProvider implements Provider {
  readonly name = 'gemini' as const;

  async snapshot(ctx: StatusContext): Promise<AgentSnapshot> {
    const path = telemetryPath();
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { agent: this.name, today: emptyWindow(), warning: TELEMETRY_HELP };
      }
      throw err;
    }

    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return { agent: this.name, today: emptyWindow(), warning: TELEMETRY_HELP };
    }

    const todayStart = startOfTodayMs();
    const pricing = await loadPricing();

    const todayByModel = new Map<string, TokenCounts>();
    const sessionByModel = new Map<string, TokenCounts>();
    let lastSessionId: string | undefined = ctx.sessionId;
    let latestSessionStart = 0;

    // First pass: discover the most-recent session id today (if not provided in ctx).
    if (!lastSessionId) {
      for (const line of raw.split('\n')) {
        if (!line) continue;
        const rec = parseRecord(line);
        if (!rec) continue;
        if (!isApiResponse(rec)) continue;
        const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
        if (!Number.isFinite(ts) || ts < todayStart) continue;
        const sid = rec.attributes?.['session.id'];
        if (typeof sid === 'string' && ts >= latestSessionStart) {
          latestSessionStart = ts;
          lastSessionId = sid;
        }
      }
    }

    // Second pass: accumulate.
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const rec = parseRecord(line);
      if (!rec) continue;
      if (!isApiResponse(rec)) continue;
      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < todayStart) continue;
      const a = rec.attributes ?? {};
      const model = typeof a.model === 'string' ? a.model : 'unknown';
      const tokens: TokenCounts = {
        input: numOr0(a.input_token_count),
        output: numOr0(a.output_token_count),
        cacheRead: numOr0(a.cached_content_token_count),
        cacheWrite: 0,
      };
      mergeInto(todayByModel, model, tokens);
      if (lastSessionId && a['session.id'] === lastSessionId) {
        mergeInto(sessionByModel, model, tokens);
      }
    }

    const today = aggregateWindow(todayByModel, pricing);
    const snapshot: AgentSnapshot = { agent: this.name, today };
    if (sessionByModel.size > 0) {
      snapshot.session = aggregateWindow(sessionByModel, pricing);
    }
    return snapshot;
  }
}

function parseRecord(line: string): GeminiTelemetryRecord | null {
  try {
    return JSON.parse(line) as GeminiTelemetryRecord;
  } catch {
    return null;
  }
}

function isApiResponse(rec: GeminiTelemetryRecord): boolean {
  if (rec.name === 'gemini_cli.api_response') return true;
  if (rec.attributes?.['event.name'] === 'gemini_cli.api_response') return true;
  return false;
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
