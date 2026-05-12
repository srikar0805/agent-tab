import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProvider } from '../../src/providers/codex.js';
import { todayDateParts } from '../../src/time.js';
import { _resetPricingCache } from '../../src/pricing.js';

let tmp: string;
let prevHome: string | undefined;
let prevCacheDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-codex-'));
  prevHome = process.env.CODEX_HOME;
  prevCacheDir = process.env.AGENT_TAB_CACHE_DIR;
  process.env.CODEX_HOME = tmp;
  process.env.AGENT_TAB_CACHE_DIR = join(tmp, '.cache');
  _resetPricingCache();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevHome;
  if (prevCacheDir === undefined) delete process.env.AGENT_TAB_CACHE_DIR;
  else process.env.AGENT_TAB_CACHE_DIR = prevCacheDir;
  await rm(tmp, { recursive: true, force: true });
});

const todayIso = () => new Date().toISOString();

function turnContext(model: string, ts = todayIso()): string {
  return JSON.stringify({ timestamp: ts, payload: { type: 'turn_context', model } });
}

function tokenCount(
  cum: { input?: number; output?: number; cached?: number },
  ts = todayIso(),
): string {
  return JSON.stringify({
    timestamp: ts,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: cum.input ?? 0,
          output_tokens: cum.output ?? 0,
          cached_input_tokens: cum.cached ?? 0,
        },
      },
    },
  });
}

async function writeRollout(filename: string, lines: string[]) {
  const { year, month, day } = todayDateParts();
  const dir = join(tmp, 'sessions', year, month, day);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), lines.join('\n') + '\n', 'utf8');
}

describe('CodexProvider', () => {
  it('returns empty when sessions dir is missing', async () => {
    const snap = await new CodexProvider().snapshot({});
    expect(snap.today.costUsd).toBe(0);
    expect(snap.session).toBeUndefined();
  });

  it('diffs cumulative token counts to derive per-turn deltas', async () => {
    await writeRollout('rollout-x.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 1_000_000, output: 100_000 }),
      tokenCount({ input: 1_500_000, output: 250_000 }),
      tokenCount({ input: 2_000_000, output: 400_000 }),
    ]);
    const snap = await new CodexProvider().snapshot({});
    // Final cumulative = 2M input, 400k output → 2M*1.25 + 400k*10 = 2.5 + 4.0 = 6.5
    expect(snap.today.inputTokens).toBe(2_000_000);
    expect(snap.today.outputTokens).toBe(400_000);
    expect(snap.today.costUsd).toBeCloseTo(2.5 + 4.0, 6);
    expect(snap.today.primaryModel).toBe('gpt-5-codex');
  });

  it('aggregates today across multiple rollout files', async () => {
    await writeRollout('rollout-a.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 500_000, output: 50_000 }),
    ]);
    await writeRollout('rollout-b.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 1_000_000, output: 100_000 }),
    ]);
    const snap = await new CodexProvider().snapshot({});
    expect(snap.today.inputTokens).toBe(1_500_000);
    expect(snap.today.outputTokens).toBe(150_000);
  });

  it('produces a session window from the most-recently-modified rollout', async () => {
    await writeRollout('rollout-old.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 500_000, output: 50_000 }),
    ]);
    // brief delay so mtimes differ
    await new Promise((r) => setTimeout(r, 20));
    await writeRollout('rollout-new.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 200_000, output: 20_000 }),
    ]);
    const snap = await new CodexProvider().snapshot({});
    expect(snap.session).toBeDefined();
    // session = newest rollout only
    expect(snap.session?.inputTokens).toBe(200_000);
    expect(snap.session?.outputTokens).toBe(20_000);
  });

  it('skips token_count lines from before today', async () => {
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    await writeRollout('rollout-mixed.jsonl', [
      turnContext('gpt-5-codex'),
      tokenCount({ input: 1_000_000, output: 100_000 }, yesterday),
      tokenCount({ input: 1_500_000, output: 200_000 }),
    ]);
    const snap = await new CodexProvider().snapshot({});
    // Yesterday's line sets prev to (1M,100k); today's first delta is (500k,100k).
    expect(snap.today.inputTokens).toBe(500_000);
    expect(snap.today.outputTokens).toBe(100_000);
  });
});
