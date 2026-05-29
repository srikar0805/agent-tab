export interface ModelPricing {
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  in: number;
  out: number;
  inHi?: number;
  outHi?: number;
  longCtxThreshold?: number;
  cw: number;
  maxOut?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { provider: 'anthropic', in: 5.0, out: 25.0, cw: 1_000_000, maxOut: 128_000 },
  'claude-opus-4-6': { provider: 'anthropic', in: 5.0, out: 25.0, cw: 1_000_000, maxOut: 128_000 },
  'claude-sonnet-4-6': { provider: 'anthropic', in: 3.0, out: 15.0, cw: 1_000_000, maxOut: 64_000 },
  'claude-haiku-4-5': { provider: 'anthropic', in: 1.0, out: 5.0, cw: 200_000, maxOut: 64_000 },

  'gpt-5.5': { provider: 'openai', in: 5.0, out: 30.0, cw: 400_000 },
  'gpt-5.4': {
    provider: 'openai',
    in: 2.5,
    out: 15.0,
    cw: 272_000,
    inHi: 5.0,
    outHi: 30.0,
    longCtxThreshold: 272_000
  },
  'gpt-4o': { provider: 'openai', in: 2.5, out: 10.0, cw: 128_000 },
  'gpt-4o-mini': { provider: 'openai', in: 0.15, out: 0.6, cw: 128_000 },
  'gpt-4-turbo': { provider: 'openai', in: 10.0, out: 30.0, cw: 128_000 },
  'gpt-3.5-turbo': { provider: 'openai', in: 0.5, out: 1.5, cw: 16_385 },
  'o1': { provider: 'openai', in: 15.0, out: 60.0, cw: 200_000 },
  'o3': { provider: 'openai', in: 2.0, out: 8.0, cw: 200_000 },
  'o4-mini': { provider: 'openai', in: 1.1, out: 4.4, cw: 200_000 },

  'gemini-3.1-pro': {
    provider: 'gemini',
    in: 2.0,
    out: 12.0,
    cw: 2_000_000,
    inHi: 4.0,
    outHi: 18.0,
    longCtxThreshold: 200_000
  },
  'gemini-2.5-pro': {
    provider: 'gemini',
    in: 1.25,
    out: 10.0,
    cw: 1_000_000,
    inHi: 2.5,
    outHi: 15.0,
    longCtxThreshold: 200_000
  },
  'gemini-2.5-flash': { provider: 'gemini', in: 0.3, out: 2.5, cw: 1_000_000 },
  'gemini-2.5-flash-lite': { provider: 'gemini', in: 0.1, out: 0.4, cw: 1_000_000 },
  'gemini-2.0-flash': { provider: 'gemini', in: 0.1, out: 0.4, cw: 1_000_000 },

  'ollama:default': { provider: 'ollama', in: 0, out: 0, cw: 8_192 }
};

export function priceFor(model: string): ModelPricing {
  return PRICING[model] ?? PRICING['ollama:default'];
}

export function computeCostUSD(model: string, inputTokens: number, outputTokens: number) {
  const p = priceFor(model);
  const inputAboveThreshold = !!p.longCtxThreshold && inputTokens > p.longCtxThreshold;
  const inRate = inputAboveThreshold && p.inHi ? p.inHi : p.in;
  const outRate = inputAboveThreshold && p.outHi ? p.outHi : p.out;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}
