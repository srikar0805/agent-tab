import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPricing, lookupModel, costFor, _resetPricingCache } from '../src/pricing.js';
import { writeCache } from '../src/modelsDev.js';

let tmp: string;
let prevCacheDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-pricing-'));
  prevCacheDir = process.env.AGENT_TAB_CACHE_DIR;
  process.env.AGENT_TAB_CACHE_DIR = tmp;
  _resetPricingCache();
});

afterEach(async () => {
  if (prevCacheDir === undefined) delete process.env.AGENT_TAB_CACHE_DIR;
  else process.env.AGENT_TAB_CACHE_DIR = prevCacheDir;
  await rm(tmp, { recursive: true, force: true });
});

describe('loadPricing', () => {
  it('returns bundled pricing with no cache present', async () => {
    const p = await loadPricing();
    expect(p.bundled.unit).toBe('per_million_tokens');
    expect(p.bundled.currency).toBe('USD');
    expect(p.cache).toBeNull();
    expect(p.bundled.models['claude-sonnet-4-6']).toBeDefined();
  });

  it('exposes the cache when one is present', async () => {
    await writeCache({
      fetched_at: new Date().toISOString(),
      source: 'test',
      models: { 'fake-model-xyz': { input: 1, output: 2 } },
    });
    const p = await loadPricing();
    expect(p.cache).not.toBeNull();
    expect(p.cache?.models['fake-model-xyz']?.input).toBe(1);
  });
});

describe('lookupModel — bundled only', () => {
  it('finds by canonical name', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6')?.input).toBe(3.0);
  });

  it('finds by alias', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6-20260101')?.input).toBe(3.0);
  });

  it('returns null for unknown', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'totally-made-up')).toBeNull();
  });

  it('matches free-model patterns', async () => {
    const p = await loadPricing();
    const m = lookupModel(p, 'ollama:llama3:70b');
    expect(m?.input).toBe(0);
  });
});

describe('lookupModel — cache overrides bundled', () => {
  it('prefers cache when it has the model', async () => {
    await writeCache({
      fetched_at: new Date().toISOString(),
      source: 'test',
      // Different rate than bundled for claude-sonnet-4-6
      models: { 'claude-sonnet-4-6': { input: 99, output: 99 } },
    });
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6')?.input).toBe(99);
  });

  it('falls back to bundled when cache lacks the model', async () => {
    await writeCache({
      fetched_at: new Date().toISOString(),
      source: 'test',
      models: { 'unrelated-model': { input: 1, output: 2 } },
    });
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6')?.input).toBe(3.0);
  });

  it('cache match with date suffix stripped', async () => {
    await writeCache({
      fetched_at: new Date().toISOString(),
      source: 'test',
      models: { 'shiny-new-model': { input: 1.5, output: 6.0 } },
    });
    const p = await loadPricing();
    expect(lookupModel(p, 'shiny-new-model-20260301')?.input).toBe(1.5);
  });
});

describe('costFor', () => {
  it('reports known=true and a non-zero cost for a known model', async () => {
    const p = await loadPricing();
    const r = costFor(p, 'claude-sonnet-4-6', { input: 1_000_000, output: 0 });
    expect(r.known).toBe(true);
    expect(r.cost).toBeCloseTo(3.0, 6);
  });

  it('reports known=false for an unknown model', async () => {
    const p = await loadPricing();
    const r = costFor(p, 'made-up-model-99', { input: 5_000_000, output: 5_000_000 });
    expect(r.known).toBe(false);
    expect(r.cost).toBe(0);
  });

  it('reports known=true with 0 cost for free models', async () => {
    const p = await loadPricing();
    const r = costFor(p, 'ollama:qwen', { input: 1_000_000, output: 1_000_000 });
    expect(r.known).toBe(true);
    expect(r.cost).toBe(0);
  });
});
