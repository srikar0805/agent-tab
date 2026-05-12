import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface ModelPricing {
  input: number;
  output: number;
  cache_write?: number;
  cache_read?: number;
  aliases?: string[];
}

interface PricingFile {
  unit: 'per_million_tokens';
  currency: string;
  models: Record<string, ModelPricing>;
  free_models?: string[];
}

let cached: PricingFile | null = null;

export async function loadPricing(): Promise<PricingFile> {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/pricing.js → ../assets/pricing.json
  // Source layout: src/pricing.ts → ../assets/pricing.json (vitest runs from src)
  const path = join(here, '..', 'assets', 'pricing.json');
  const raw = await readFile(path, 'utf8');
  cached = JSON.parse(raw) as PricingFile;
  return cached;
}

export function lookupModel(
  pricing: PricingFile,
  modelName: string,
): ModelPricing | null {
  if (pricing.models[modelName]) return pricing.models[modelName];
  for (const [, def] of Object.entries(pricing.models)) {
    if (def.aliases?.includes(modelName)) return def;
  }
  if (pricing.free_models) {
    for (const pat of pricing.free_models) {
      if (matchPattern(pat, modelName)) {
        return { input: 0, output: 0, cache_write: 0, cache_read: 0 };
      }
    }
  }
  return null;
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

/** Cost in USD for a single (model, tokens) pair. Returns 0 for unknown models. */
export function costFor(
  pricing: PricingFile,
  modelName: string,
  tokens: TokenCounts,
): number {
  const m = lookupModel(pricing, modelName);
  if (!m) return 0;
  const PER_M = 1_000_000;
  return (
    (tokens.input * m.input) / PER_M +
    (tokens.output * m.output) / PER_M +
    ((tokens.cacheRead ?? 0) * (m.cache_read ?? 0)) / PER_M +
    ((tokens.cacheWrite ?? 0) * (m.cache_write ?? 0)) / PER_M
  );
}

/** Reset module-level pricing cache. Test-only helper. */
export function _resetPricingCache(): void {
  cached = null;
}
