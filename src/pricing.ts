import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  lookupNormalized,
  readCache,
  type NormalizedCatalog,
  type NormalizedModelPricing,
} from './modelsDev.js';

export interface ModelPricing {
  input: number;
  output: number;
  cache_write?: number;
  cache_read?: number;
  aliases?: string[];
}

interface BundledPricingFile {
  unit: 'per_million_tokens';
  currency: string;
  models: Record<string, ModelPricing>;
  free_models?: string[];
}

export interface EffectivePricing {
  bundled: BundledPricingFile;
  cache: NormalizedCatalog | null;
}

let cachedBundled: BundledPricingFile | null = null;

export async function loadBundled(): Promise<BundledPricingFile> {
  if (cachedBundled) return cachedBundled;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', 'assets', 'pricing.json');
  const raw = await readFile(path, 'utf8');
  cachedBundled = JSON.parse(raw) as BundledPricingFile;
  return cachedBundled;
}

export async function loadPricing(): Promise<EffectivePricing> {
  const [bundled, cache] = await Promise.all([loadBundled(), readCache()]);
  return { bundled, cache };
}

/**
 * Lookup order:
 *   1. exact match in models.dev cache
 *   2. cache lookup with date/version suffix stripped
 *   3. exact match in bundled
 *   4. bundled alias match
 *   5. bundled free-model glob (ollama:*, llamacpp:*)
 */
export function lookupModel(
  eff: EffectivePricing,
  modelName: string,
): ModelPricing | null {
  if (!modelName) return null;

  if (eff.cache) {
    const fromCache = lookupNormalized(eff.cache, modelName);
    if (fromCache) return normalizedToModelPricing(fromCache);
  }

  if (eff.bundled.models[modelName]) return eff.bundled.models[modelName];

  for (const [, def] of Object.entries(eff.bundled.models)) {
    if (def.aliases?.includes(modelName)) return def;
  }

  if (eff.bundled.free_models) {
    for (const pat of eff.bundled.free_models) {
      if (matchPattern(pat, modelName)) {
        return { input: 0, output: 0, cache_write: 0, cache_read: 0 };
      }
    }
  }

  return null;
}

function normalizedToModelPricing(n: NormalizedModelPricing): ModelPricing {
  return {
    input: n.input,
    output: n.output,
    ...(typeof n.cache_read === 'number' ? { cache_read: n.cache_read } : {}),
    ...(typeof n.cache_write === 'number' ? { cache_write: n.cache_write } : {}),
  };
}

function matchPattern(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return re.test(name);
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CostResult {
  cost: number;
  known: boolean;
}

/** Cost in USD for (model, tokens). `known: false` means we had no pricing for this model. */
export function costFor(
  eff: EffectivePricing,
  modelName: string,
  tokens: TokenCounts,
): CostResult {
  const m = lookupModel(eff, modelName);
  if (!m) return { cost: 0, known: false };
  const PER_M = 1_000_000;
  const cost =
    (tokens.input * m.input) / PER_M +
    (tokens.output * m.output) / PER_M +
    ((tokens.cacheRead ?? 0) * (m.cache_read ?? 0)) / PER_M +
    ((tokens.cacheWrite ?? 0) * (m.cache_write ?? 0)) / PER_M;
  return { cost, known: true };
}

/** Test-only helper. */
export function _resetPricingCache(): void {
  cachedBundled = null;
}
