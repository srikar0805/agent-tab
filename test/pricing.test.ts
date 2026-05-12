import { describe, it, expect, beforeEach } from 'vitest';
import { loadPricing, lookupModel, costFor, _resetPricingCache } from '../src/pricing.js';

beforeEach(() => _resetPricingCache());

describe('loadPricing', () => {
  it('loads the bundled pricing.json with expected models', async () => {
    const p = await loadPricing();
    expect(p.unit).toBe('per_million_tokens');
    expect(p.currency).toBe('USD');
    expect(p.models['claude-sonnet-4-6']).toBeDefined();
    expect(p.models['claude-opus-4-7']).toBeDefined();
    expect(p.models['gpt-5-codex']).toBeDefined();
    expect(p.models['gemini-2.5-pro']).toBeDefined();
  });
});

describe('lookupModel', () => {
  it('finds a model by canonical name', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6')?.input).toBe(3.0);
  });

  it('finds a model by alias', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'claude-sonnet-4-6-20260101')?.input).toBe(3.0);
    expect(lookupModel(p, 'anthropic.claude-opus-4-7-v1:0')?.input).toBe(15.0);
  });

  it('returns null for an unknown model', async () => {
    const p = await loadPricing();
    expect(lookupModel(p, 'made-up-model')).toBeNull();
  });

  it('matches free-model glob patterns', async () => {
    const p = await loadPricing();
    const m = lookupModel(p, 'ollama:llama3:70b');
    expect(m).not.toBeNull();
    expect(m?.input).toBe(0);
  });
});

describe('costFor', () => {
  it('computes cost as sum of (tokens × per-million rate) / 1e6', async () => {
    const p = await loadPricing();
    // Sonnet: input 3.0, output 15.0 per million
    const cost = costFor(p, 'claude-sonnet-4-6', { input: 1_000_000, output: 100_000 });
    expect(cost).toBeCloseTo(3.0 + (100_000 * 15.0) / 1_000_000, 6);
  });

  it('includes cache rates when present', async () => {
    const p = await loadPricing();
    // Sonnet: cache_read 0.3, cache_write 3.75
    const cost = costFor(p, 'claude-sonnet-4-6', {
      input: 0,
      output: 0,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3 + 3.75, 6);
  });

  it('returns 0 for an unknown model', async () => {
    const p = await loadPricing();
    expect(costFor(p, 'unknown', { input: 5_000_000, output: 5_000_000 })).toBe(0);
  });

  it('returns 0 cost for free models even with high token counts', async () => {
    const p = await loadPricing();
    expect(costFor(p, 'ollama:qwen', { input: 10_000_000, output: 10_000_000 })).toBe(0);
  });
});
