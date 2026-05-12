export const AGENT_NAMES = ['claude', 'codex', 'gemini'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export function isAgentName(s: string): s is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(s);
}

export interface UsageWindow {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  primaryModel?: string;
  /** True if any model contributing to this window had no pricing entry. */
  unknownPricing?: boolean;
}

export interface AgentSnapshot {
  agent: AgentName;
  today: UsageWindow;
  session?: UsageWindow;
  warning?: string;
}

export interface StatusContext {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
}

export interface Provider {
  readonly name: AgentName;
  snapshot(ctx: StatusContext): Promise<AgentSnapshot>;
}

export function emptyWindow(): UsageWindow {
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    unknownPricing: false,
  };
}
