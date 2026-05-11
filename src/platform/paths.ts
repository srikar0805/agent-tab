import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type ProviderId =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'copilot'
  | 'cursor'
  | `custom:${string}`
  | `mcp:${string}`;

export interface AgentDataPaths {
  home: string;
  sessions?: string;
  credentials?: string;
  config?: string;
}

const isWin = platform() === 'win32';
const isMac = platform() === 'darwin';

function appData(): string {
  if (isWin) {
    return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  }
  if (isMac) {
    return join(homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

export function claudeCodePaths(): AgentDataPaths {
  const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return {
    home,
    sessions: join(home, 'projects'),
    credentials: join(home, '.credentials.json'),
    config: join(homedir(), '.claude.json'),
  };
}

export function codexPaths(): AgentDataPaths {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  return {
    home,
    sessions: join(home, 'sessions'),
    credentials: join(home, 'auth.json'),
    config: join(home, 'config.toml'),
  };
}

export function geminiPaths(): AgentDataPaths {
  const home = process.env.GEMINI_CONFIG_DIR ?? join(homedir(), '.gemini');
  return {
    home,
    sessions: join(home, 'tmp'),
    credentials: join(home, 'oauth_creds.json'),
  };
}

export function cursorPaths(): AgentDataPaths {
  const home = join(appData(), 'Cursor');
  return {
    home,
    sessions: join(home, 'logs'),
    config: join(home, 'User', 'globalStorage', 'state.vscdb'),
  };
}

/**
 * Markers that indicate a directory lives inside a third-party sync root
 * (Dropbox / iCloud / OneDrive / Syncthing / Nextcloud). See §16 OQ3.
 */
export const SYNC_MARKERS: ReadonlyArray<{ marker: string; provider: string }> = [
  { marker: '.dropbox', provider: 'Dropbox' },
  { marker: '.dropbox.cache', provider: 'Dropbox' },
  { marker: '.stfolder', provider: 'Syncthing' },
  { marker: '.stignore', provider: 'Syncthing' },
  { marker: '.nextcloudsync.log', provider: 'Nextcloud' },
  { marker: 'desktop.ini', provider: 'OneDrive' },
];
