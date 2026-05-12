import type { AgentSnapshot, UsageWindow } from './providers/types.js';

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

export interface FormatOptions {
  color?: boolean;
}

export function formatSnapshot(snap: AgentSnapshot, opts: FormatOptions = {}): string {
  const useColor = opts.color ?? colorEnabledByDefault();
  const c = useColor ? ANSI : Object.fromEntries(Object.keys(ANSI).map((k) => [k, '']));

  if (snap.warning) {
    return `${c.dim}[${snap.agent}]${c.reset} ${c.yellow}${snap.warning}${c.reset}`;
  }

  const prefix = `${c.dim}[${c.reset}${c.cyan}${snap.agent}${c.reset}${c.dim}]${c.reset}`;
  const parts: string[] = [];

  if (snap.session) {
    parts.push(`session ${c.bold}${formatWindowCost(snap.session)}${c.reset}`);
  }
  parts.push(`today ${c.bold}${formatWindowCost(snap.today)}${c.reset}`);
  parts.push(`${c.dim}${formatTokens(totalTokens(snap.today))} tok${c.reset}`);

  if (snap.today.primaryModel) {
    parts.push(`${c.dim}${snap.today.primaryModel}${c.reset}`);
  }

  return parts.length === 0
    ? prefix
    : `${prefix} ${parts.join(` ${c.dim}·${c.reset} `)}`;
}

/** Cost display for a window. Shows `$?` or `$X.XX+?` when pricing is missing. */
export function formatWindowCost(w: UsageWindow): string {
  const tokens = totalTokens(w);
  if (w.unknownPricing && tokens > 0) {
    if (w.costUsd > 0) return `${formatCost(w.costUsd)}+?`;
    return '$?';
  }
  return formatCost(w.costUsd);
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function totalTokens(w: UsageWindow): number {
  return w.inputTokens + w.outputTokens + w.cacheReadTokens + w.cacheWriteTokens;
}

function colorEnabledByDefault(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR.length > 0) return true;
  return true;
}
