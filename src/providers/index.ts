import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { GeminiProvider } from './gemini.js';
import type { AgentName, Provider } from './types.js';

const REGISTRY: Record<AgentName, Provider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  gemini: new GeminiProvider(),
};

export function getProvider(name: AgentName): Provider {
  return REGISTRY[name];
}
