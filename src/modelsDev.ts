import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 10_000;

/** Normalized per-model pricing — same unit (per-million-tokens, USD) as bundled pricing.json. */
export interface NormalizedModelPricing {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface NormalizedCatalog {
  fetched_at: string;            // ISO8601
  source: string;                // URL we pulled from
  models: Record<string, NormalizedModelPricing>;
}

export function cacheDir(): string {
  if (process.env.AGENT_TAB_CACHE_DIR && process.env.AGENT_TAB_CACHE_DIR.length > 0) {
    return process.env.AGENT_TAB_CACHE_DIR;
  }
  if (process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.length > 0) {
    return join(process.env.XDG_CACHE_HOME, 'agent-tab');
  }
  return join(homedir(), '.cache', 'agent-tab');
}

export function cachePath(): string {
  return join(cacheDir(), 'models.json');
}

export async function readCache(): Promise<NormalizedCatalog | null> {
  try {
    const raw = await readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as NormalizedCatalog;
    if (!parsed || typeof parsed !== 'object' || !parsed.models) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null; // malformed cache — treat as missing, will be refreshed
  }
}

export async function writeCache(catalog: NormalizedCatalog): Promise<void> {
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

export function cacheAgeMs(catalog: NormalizedCatalog, now: Date = new Date()): number {
  const fetched = Date.parse(catalog.fetched_at);
  if (!Number.isFinite(fetched)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - fetched);
}

export interface ModelsDevProvider {
  id?: string;
  models?: Record<string, ModelsDevModel>;
}

export interface ModelsDevModel {
  id?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export type ModelsDevRoot = Record<string, ModelsDevProvider>;

export function normalize(raw: ModelsDevRoot, now: Date = new Date()): NormalizedCatalog {
  const models: Record<string, NormalizedModelPricing> = {};
  for (const [, provider] of Object.entries(raw ?? {})) {
    if (!provider?.models || typeof provider.models !== 'object') continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      const cost = model?.cost;
      if (!cost) continue;
      if (typeof cost.input !== 'number' || typeof cost.output !== 'number') continue;
      const key = (typeof model.id === 'string' && model.id.length > 0) ? model.id : modelId;
      models[key] = {
        input: cost.input,
        output: cost.output,
        ...(typeof cost.cache_read === 'number' ? { cache_read: cost.cache_read } : {}),
        ...(typeof cost.cache_write === 'number' ? { cache_write: cost.cache_write } : {}),
      };
    }
  }
  return {
    fetched_at: now.toISOString(),
    source: MODELS_DEV_URL,
    models,
  };
}

/**
 * Look up a model by name with progressive fallback:
 *   1. exact match
 *   2. strip a trailing date suffix like `-20260101`
 *   3. strip after the last `-` (for any other version suffix)
 *
 * Returns null when nothing matches.
 */
export function lookupNormalized(
  catalog: NormalizedCatalog,
  modelName: string,
): NormalizedModelPricing | null {
  if (!modelName) return null;
  const direct = catalog.models[modelName];
  if (direct) return direct;
  const stripped = modelName.replace(/-\d{8}$/, '');
  if (stripped !== modelName && catalog.models[stripped]) return catalog.models[stripped];
  const lastDash = modelName.lastIndexOf('-');
  if (lastDash > 0) {
    const trimmed = modelName.slice(0, lastDash);
    if (catalog.models[trimmed]) return catalog.models[trimmed];
  }
  return null;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetcher: Fetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, json: () => res.json() };
  } finally {
    clearTimeout(timer);
  }
};

export async function fetchAndCache(
  fetcher: Fetcher = defaultFetcher,
  now: Date = new Date(),
): Promise<NormalizedCatalog> {
  const res = await fetcher(MODELS_DEV_URL);
  if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
  const raw = (await res.json()) as ModelsDevRoot;
  const catalog = normalize(raw, now);
  if (Object.keys(catalog.models).length === 0) {
    throw new Error('models.dev response contained no pricing entries');
  }
  await writeCache(catalog);
  return catalog;
}
