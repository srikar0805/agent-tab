import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { _resetPricingCache } from '../../src/pricing.js';

let tmp: string;
let prevGeminiHome: string | undefined;
let prevCacheDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-gemini-'));
  prevGeminiHome = process.env.GEMINI_HOME;
  prevCacheDir = process.env.AGENT_TAB_CACHE_DIR;
  process.env.GEMINI_HOME = join(tmp, '.gemini');
  process.env.AGENT_TAB_CACHE_DIR = join(tmp, '.cache');
  _resetPricingCache();
});

afterEach(async () => {
  if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
  else process.env.GEMINI_HOME = prevGeminiHome;
  if (prevCacheDir === undefined) delete process.env.AGENT_TAB_CACHE_DIR;
  else process.env.AGENT_TAB_CACHE_DIR = prevCacheDir;
  await rm(tmp, { recursive: true, force: true });
});

const todayIso = () => new Date().toISOString();

function apiResponse(opts: {
  model: string;
  input: number;
  output: number;
  cached?: number;
  sessionId?: string;
  ts?: string;
}): string {
  return JSON.stringify({
    name: 'gemini_cli.api_response',
    timestamp: opts.ts ?? todayIso(),
    attributes: {
      model: opts.model,
      input_token_count: opts.input,
      output_token_count: opts.output,
      cached_content_token_count: opts.cached ?? 0,
      'session.id': opts.sessionId ?? 'sess-default',
    },
  });
}

async function writeTelemetry(lines: string[]) {
  const dir = join(tmp, '.gemini');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'telemetry.log'), lines.join('\n') + '\n', 'utf8');
}

describe('GeminiProvider', () => {
  it('returns a warning when telemetry.log is missing', async () => {
    const snap = await new GeminiProvider().snapshot({});
    expect(snap.warning).toBeDefined();
    expect(snap.warning).toContain('telemetry not enabled');
    expect(snap.today.costUsd).toBe(0);
  });

  it('aggregates today api_response events', async () => {
    await writeTelemetry([
      apiResponse({ model: 'gemini-2.5-pro', input: 1_000_000, output: 100_000 }),
      apiResponse({ model: 'gemini-2.5-pro', input: 500_000, output: 50_000 }),
    ]);
    const snap = await new GeminiProvider().snapshot({});
    expect(snap.warning).toBeUndefined();
    // gemini-2.5-pro: input $1.25/M, output $5/M
    // (1.5M * 1.25) + (150k * 5) = 1.875 + 0.75 = 2.625
    expect(snap.today.costUsd).toBeCloseTo(2.625, 6);
    expect(snap.today.inputTokens).toBe(1_500_000);
    expect(snap.today.outputTokens).toBe(150_000);
  });

  it('scopes session window to a provided session id', async () => {
    await writeTelemetry([
      apiResponse({ model: 'gemini-2.5-pro', input: 1_000_000, output: 100_000, sessionId: 'A' }),
      apiResponse({ model: 'gemini-2.5-pro', input: 200_000, output: 20_000, sessionId: 'B' }),
    ]);
    const snap = await new GeminiProvider().snapshot({ sessionId: 'B' });
    expect(snap.session).toBeDefined();
    expect(snap.session?.inputTokens).toBe(200_000);
    expect(snap.today.inputTokens).toBe(1_200_000);
  });

  it('falls back to most-recent session when ctx.sessionId is missing', async () => {
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await writeTelemetry([
      apiResponse({
        model: 'gemini-2.5-pro',
        input: 1_000_000,
        output: 100_000,
        sessionId: 'A',
        ts: earlier,
      }),
      apiResponse({ model: 'gemini-2.5-pro', input: 200_000, output: 20_000, sessionId: 'B' }),
    ]);
    const snap = await new GeminiProvider().snapshot({});
    expect(snap.session?.inputTokens).toBe(200_000);
  });

  it('skips events before today', async () => {
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    await writeTelemetry([
      apiResponse({
        model: 'gemini-2.5-pro',
        input: 5_000_000,
        output: 500_000,
        ts: yesterday,
      }),
      apiResponse({ model: 'gemini-2.5-pro', input: 100_000, output: 10_000 }),
    ]);
    const snap = await new GeminiProvider().snapshot({});
    expect(snap.today.inputTokens).toBe(100_000);
  });

  it('tolerates malformed lines', async () => {
    await writeTelemetry([
      'not json',
      apiResponse({ model: 'gemini-2.5-pro', input: 100_000, output: 10_000 }),
      '{"name":"unrelated.event"}',
    ]);
    const snap = await new GeminiProvider().snapshot({});
    expect(snap.today.inputTokens).toBe(100_000);
  });
});
