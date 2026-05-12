import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeProvider } from '../../src/providers/claude.js';
import { _resetPricingCache } from '../../src/pricing.js';

let tmp: string;
let prevDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-claude-'));
  prevDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmp;
  _resetPricingCache();
});

afterEach(async () => {
  if (prevDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevDir;
  await rm(tmp, { recursive: true, force: true });
});

const todayIso = () => new Date().toISOString();

function assistantLine(opts: {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  ts?: string;
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.ts ?? todayIso(),
    message: {
      model: opts.model,
      usage: {
        input_tokens: opts.input,
        output_tokens: opts.output,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
      },
    },
  });
}

async function writeSession(projectDir: string, sessionId: string, lines: string[]) {
  const dir = join(tmp, 'projects', projectDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

describe('ClaudeProvider', () => {
  it('returns empty when projects dir is missing', async () => {
    const snap = await new ClaudeProvider().snapshot({});
    expect(snap.agent).toBe('claude');
    expect(snap.today.costUsd).toBe(0);
    expect(snap.session).toBeUndefined();
  });

  it('aggregates today across multiple sessions and projects', async () => {
    await writeSession('proj-a', 'sess-1', [
      assistantLine({ model: 'claude-sonnet-4-6', input: 1_000_000, output: 0 }),
    ]);
    await writeSession('proj-b', 'sess-2', [
      assistantLine({ model: 'claude-sonnet-4-6', input: 0, output: 100_000 }),
    ]);
    const snap = await new ClaudeProvider().snapshot({});
    // sonnet: input $3/M, output $15/M => 3.0 + 1.5 = 4.5
    expect(snap.today.costUsd).toBeCloseTo(4.5, 6);
    expect(snap.today.inputTokens).toBe(1_000_000);
    expect(snap.today.outputTokens).toBe(100_000);
    expect(snap.today.primaryModel).toBe('claude-sonnet-4-6');
  });

  it('produces a session window when sessionId is provided', async () => {
    await writeSession('proj-a', 'live-session', [
      assistantLine({ model: 'claude-sonnet-4-6', input: 200_000, output: 50_000 }),
    ]);
    await writeSession('proj-a', 'other-session', [
      assistantLine({ model: 'claude-sonnet-4-6', input: 1_000_000, output: 100_000 }),
    ]);
    const snap = await new ClaudeProvider().snapshot({ sessionId: 'live-session' });
    expect(snap.session).toBeDefined();
    expect(snap.session?.inputTokens).toBe(200_000);
    expect(snap.session?.outputTokens).toBe(50_000);
    // session sonnet: 200k*3 + 50k*15 = 0.6 + 0.75 = 1.35
    expect(snap.session?.costUsd).toBeCloseTo(1.35, 6);
    // today sums both
    expect(snap.today.inputTokens).toBe(1_200_000);
  });

  it('ignores assistant lines from before today', async () => {
    const yesterdayIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    await writeSession('proj-a', 'sess-old', [
      assistantLine({ model: 'claude-sonnet-4-6', input: 1_000_000, output: 0, ts: yesterdayIso }),
      assistantLine({ model: 'claude-sonnet-4-6', input: 100_000, output: 0 }),
    ]);
    const snap = await new ClaudeProvider().snapshot({});
    // Only the second line counts toward today.
    expect(snap.today.inputTokens).toBe(100_000);
  });

  it('skips malformed JSONL lines without crashing', async () => {
    await writeSession('proj-a', 'sess-x', [
      'this is not json',
      assistantLine({ model: 'claude-sonnet-4-6', input: 100_000, output: 0 }),
      '{"type":"user"}',
      '',
    ]);
    const snap = await new ClaudeProvider().snapshot({});
    expect(snap.today.inputTokens).toBe(100_000);
  });
});
