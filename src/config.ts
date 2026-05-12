import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AGENT_NAMES, isAgentName, type AgentName } from './providers/types.js';

interface ConfigShape {
  activeAgent: AgentName;
}

const DEFAULT_CONFIG: ConfigShape = { activeAgent: 'claude' };

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'agent-tab', 'config.json');
}

export async function readConfig(): Promise<ConfigShape> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ConfigShape>;
    const active =
      typeof parsed.activeAgent === 'string' && isAgentName(parsed.activeAgent)
        ? parsed.activeAgent
        : DEFAULT_CONFIG.activeAgent;
    return { activeAgent: active };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw err;
  }
}

export async function writeConfig(patch: Partial<ConfigShape>): Promise<ConfigShape> {
  const current = await readConfig();
  const next: ConfigShape = { ...current, ...patch };
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export const VALID_AGENTS = AGENT_NAMES;
