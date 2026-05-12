import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheAgeMs,
  cachePath,
  fetchAndCache,
  lookupNormalized,
  normalize,
  readCache,
  writeCache,
  type Fetcher,
  type ModelsDevRoot,
  type NormalizedCatalog,
} from '../src/modelsDev.js';

let tmp: string;
let prevCacheDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-modelsdev-'));
  prevCacheDir = process.env.AGENT_TAB_CACHE_DIR;
  process.env.AGENT_TAB_CACHE_DIR = tmp;
});

afterEach(async () => {
  if (prevCacheDir === undefined) delete process.env.AGENT_TAB_CACHE_DIR;
  else process.env.AGENT_TAB_CACHE_DIR = prevCacheDir;
  await rm(tmp, { recursive: true, force: true });
});

describe('normalize', () => {
  it('flattens providers/models into a single map keyed by model id', () => {
    const raw: ModelsDevRoot = {
      anthropic: {
        models: {
          'claude-opus-4-7': {
            id: 'claude-opus-4-7',
            cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
          },
        },
      },
      openai: {
        models: {
          'gpt-5-codex': { id: 'gpt-5-codex', cost: { input: 1.25, output: 10 } },
        },
      },
    };
    const cat = normalize(raw);
    expect(cat.models['claude-opus-4-7']?.input).toBe(5);
    expect(cat.models['claude-opus-4-7']?.cache_read).toBe(0.5);
    expect(cat.models['gpt-5-codex']?.output).toBe(10);
  });

  it('skips models without a numeric input/output cost', () => {
    const raw: ModelsDevRoot = {
      provX: {
        models: {
          good: { id: 'good', cost: { input: 1, output: 2 } },
          bad: { id: 'bad' },
          alsoBad: { id: 'alsoBad', cost: { input: 1 } },
        },
      },
    };
    const cat = normalize(raw);
    expect(Object.keys(cat.models)).toEqual(['good']);
  });

  it('records fetched_at and source', () => {
    const cat = normalize({}, new Date('2026-05-11T12:00:00Z'));
    expect(cat.fetched_at).toBe('2026-05-11T12:00:00.000Z');
    expect(cat.source).toContain('models.dev');
  });
});

describe('lookupNormalized', () => {
  const cat: NormalizedCatalog = {
    fetched_at: new Date().toISOString(),
    source: 'test',
    models: {
      'claude-opus-4-7': { input: 5, output: 25 },
      'gpt-5-codex': { input: 1.25, output: 10 },
    },
  };

  it('finds an exact match', () => {
    expect(lookupNormalized(cat, 'claude-opus-4-7')?.input).toBe(5);
  });

  it('strips a trailing yyyymmdd date suffix', () => {
    expect(lookupNormalized(cat, 'claude-opus-4-7-20260101')?.input).toBe(5);
  });

  it('strips after the last dash as a fallback', () => {
    expect(lookupNormalized(cat, 'gpt-5-codex-preview')?.input).toBe(1.25);
  });

  it('returns null for a truly unknown model', () => {
    expect(lookupNormalized(cat, 'totally-fake-model')).toBeNull();
  });
});

describe('cache I/O', () => {
  it('writes and reads back atomically', async () => {
    const cat: NormalizedCatalog = {
      fetched_at: new Date().toISOString(),
      source: 'test',
      models: { a: { input: 1, output: 2 } },
    };
    await writeCache(cat);
    const back = await readCache();
    expect(back?.models.a?.input).toBe(1);
  });

  it('readCache returns null when file is absent', async () => {
    const back = await readCache();
    expect(back).toBeNull();
  });

  it('readCache returns null when file is malformed', async () => {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(tmp), { recursive: true });
    await fs.writeFile(cachePath(), 'not-json', 'utf8');
    expect(await readCache()).toBeNull();
  });

  it('cacheAgeMs reflects time since fetched_at', () => {
    const cat: NormalizedCatalog = {
      fetched_at: new Date(Date.now() - 60_000).toISOString(),
      source: 'test',
      models: {},
    };
    const age = cacheAgeMs(cat);
    expect(age).toBeGreaterThanOrEqual(60_000);
    expect(age).toBeLessThan(70_000);
  });
});

describe('fetchAndCache', () => {
  it('writes the cache and returns the normalized catalog', async () => {
    const raw: ModelsDevRoot = {
      anthropic: { models: { 'claude-x': { id: 'claude-x', cost: { input: 1, output: 2 } } } },
    };
    const fakeFetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => raw,
    });
    const cat = await fetchAndCache(fakeFetcher);
    expect(cat.models['claude-x']?.input).toBe(1);
    const onDisk = await readFile(cachePath(), 'utf8');
    expect(onDisk).toContain('claude-x');
  });

  it('throws on non-ok response', async () => {
    const fakeFetcher: Fetcher = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    await expect(fetchAndCache(fakeFetcher)).rejects.toThrow(/HTTP 503/);
  });

  it('throws when response has no pricing entries', async () => {
    const fakeFetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await expect(fetchAndCache(fakeFetcher)).rejects.toThrow(/no pricing entries/);
  });
});
