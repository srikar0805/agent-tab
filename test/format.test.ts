import { describe, it, expect } from 'vitest';
import { formatSnapshot, formatCost, formatTokens } from '../src/format.js';
import { emptyWindow, type AgentSnapshot } from '../src/providers/types.js';

function snap(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    agent: 'claude',
    today: { ...emptyWindow(), costUsd: 0.42, inputTokens: 8000, outputTokens: 4000, primaryModel: 'claude-sonnet-4-6' },
    ...overrides,
  };
}

describe('formatSnapshot (no color)', () => {
  it('renders today + tokens + model when no session', () => {
    const out = formatSnapshot(snap(), { color: false });
    expect(out).toBe('[claude] today $0.42 · 12.0k tok · claude-sonnet-4-6');
  });

  it('renders session before today when session present', () => {
    const s = snap({
      session: { ...emptyWindow(), costUsd: 0.08, inputTokens: 1000, outputTokens: 500 },
    });
    const out = formatSnapshot(s, { color: false });
    expect(out).toBe('[claude] session $0.08 · today $0.42 · 12.0k tok · claude-sonnet-4-6');
  });

  it('renders a warning when present, omitting cost', () => {
    const s: AgentSnapshot = { agent: 'gemini', today: emptyWindow(), warning: 'telemetry not enabled' };
    const out = formatSnapshot(s, { color: false });
    expect(out).toBe('[gemini] telemetry not enabled');
  });

  it('renders $0.00 cleanly', () => {
    const s: AgentSnapshot = { agent: 'claude', today: emptyWindow() };
    const out = formatSnapshot(s, { color: false });
    expect(out).toBe('[claude] today $0.00 · 0 tok');
  });
});

describe('formatSnapshot (color)', () => {
  it('emits ANSI escape sequences when color enabled', () => {
    const out = formatSnapshot(snap(), { color: true });
    expect(out).toContain('\x1b[');
    expect(out).toContain('claude');
  });
});

describe('formatCost', () => {
  it('formats zero as $0.00', () => expect(formatCost(0)).toBe('$0.00'));
  it('uses 2 decimals for normal amounts', () => expect(formatCost(1.234)).toBe('$1.23'));
  it('uses 4 decimals for sub-cent amounts', () => expect(formatCost(0.0042)).toBe('$0.0042'));
});

describe('formatTokens', () => {
  it('keeps small counts as-is', () => expect(formatTokens(42)).toBe('42'));
  it('uses k for thousands', () => expect(formatTokens(12_345)).toBe('12.3k'));
  it('uses M for millions', () => expect(formatTokens(2_500_000)).toBe('2.50M'));
});
