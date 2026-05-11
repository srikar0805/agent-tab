import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCost(usd: number | null): string {
  if (usd === null) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function providerLabel(id: string): string {
  switch (id) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex CLI';
    case 'gemini':
      return 'Gemini CLI';
    case 'copilot':
      return 'GitHub Copilot';
    case 'cursor':
      return 'Cursor';
    default:
      if (id.startsWith('mcp:')) return `MCP · ${id.slice(4)}`;
      if (id.startsWith('custom:')) return `Custom · ${id.slice(7)}`;
      return id;
  }
}
