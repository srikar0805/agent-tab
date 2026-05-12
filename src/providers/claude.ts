import { readdir, readFile, stat } from 'node:fs/promises';
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

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeAssistantLine {
  type: string;
  timestamp?: string;
  message?: {
    model?: string;
    usage?: ClaudeUsage;
  };
}

function projectsRoot(): string {
  if (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.length > 0) {
    return join(process.env.CLAUDE_CONFIG_DIR, 'projects');
  }
  return join(homedir(), '.claude', 'projects');
}

export class ClaudeProvider implements Provider {
  readonly name = 'claude' as const;

  async snapshot(ctx: StatusContext): Promise<AgentSnapshot> {
    const root = projectsRoot();
    let projectDirs: string[];
    try {
      projectDirs = await readdir(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { agent: this.name, today: emptyWindow() };
      }
      throw err;
    }

    const todayStart = startOfTodayMs();
    const pricing = await loadPricing();

    // Per-model accumulators for today; track most-used model by token count.
    const todayByModel = new Map<string, TokenCounts>();
    let sessionAcc: TokenCounts | null = null;
    let sessionModel: string | undefined;
    const sessionFile = ctx.transcriptPath ?? null;
    const sessionId = ctx.sessionId ?? null;

    for (const dir of projectDirs) {
      const dirPath = join(root, dir);
      let entries: string[];
      try {
        entries = await readdir(dirPath);
      } catch {
        continue;
      }
      for (const file of entries) {
        if (!file.endsWith('.jsonl')) continue;
        const fullPath = join(dirPath, file);
        let mtime: number;
        try {
          mtime = (await stat(fullPath)).mtimeMs;
        } catch {
          continue;
        }
        // Skip files not touched today — they can't contribute to today's totals.
        if (mtime < todayStart) continue;

        const isSessionFile =
          sessionFile === fullPath ||
          (sessionId !== null && file === `${sessionId}.jsonl`);

        let raw: string;
        try {
          raw = await readFile(fullPath, 'utf8');
        } catch {
          continue;
        }
        for (const line of splitLines(raw)) {
          const evt = parseLine(line);
          if (!evt) continue;
          if (evt.type !== 'assistant' || !evt.message?.usage) continue;
          const ts = evt.timestamp ? Date.parse(evt.timestamp) : NaN;
          const isToday = Number.isFinite(ts) && ts >= todayStart;
          const model = evt.message.model ?? 'unknown';
          const tokens: TokenCounts = {
            input: evt.message.usage.input_tokens ?? 0,
            output: evt.message.usage.output_tokens ?? 0,
            cacheRead: evt.message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: evt.message.usage.cache_creation_input_tokens ?? 0,
          };

          if (isToday) {
            mergeInto(todayByModel, model, tokens);
          }

          if (isSessionFile) {
            if (!sessionAcc) sessionAcc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
            sessionAcc.input += tokens.input;
            sessionAcc.output += tokens.output;
            sessionAcc.cacheRead = (sessionAcc.cacheRead ?? 0) + (tokens.cacheRead ?? 0);
            sessionAcc.cacheWrite = (sessionAcc.cacheWrite ?? 0) + (tokens.cacheWrite ?? 0);
            sessionModel = model;
          }
        }
      }
    }

    const today = aggregateWindow(todayByModel, pricing);
    const snapshot: AgentSnapshot = { agent: this.name, today };
    if (sessionAcc) {
      const sessionWindow = emptyWindow();
      sessionWindow.inputTokens = sessionAcc.input;
      sessionWindow.outputTokens = sessionAcc.output;
      sessionWindow.cacheReadTokens = sessionAcc.cacheRead ?? 0;
      sessionWindow.cacheWriteTokens = sessionAcc.cacheWrite ?? 0;
      sessionWindow.primaryModel = sessionModel;
      sessionWindow.costUsd = costFor(pricing, sessionModel ?? 'unknown', sessionAcc);
      snapshot.session = sessionWindow;
    }
    return snapshot;
  }
}

function splitLines(raw: string): string[] {
  // Tolerate a partial trailing line (file mid-write).
  const lines = raw.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function parseLine(line: string): ClaudeAssistantLine | null {
  if (!line) return null;
  try {
    return JSON.parse(line) as ClaudeAssistantLine;
  } catch {
    return null;
  }
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
