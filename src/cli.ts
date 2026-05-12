#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readConfig, writeConfig, VALID_AGENTS } from './config.js';
import { getProvider } from './providers/index.js';
import { isAgentName, type AgentName, type StatusContext } from './providers/types.js';
import { formatSnapshot } from './format.js';
import { cacheAgeMs, fetchAndCache, readCache } from './modelsDev.js';

const VERSION = '0.2.0';

const STALE_CACHE_MS = 24 * 3600 * 1000;

const USAGE = `agent-tab — token usage / cost across Claude Code, Codex CLI, Gemini CLI

Usage:
  agent-tab [status]                Print active agent's usage (reads stdin if piped)
  agent-tab use <claude|codex|gemini>   Set the active agent
  agent-tab show                    Print the active agent
  agent-tab update-pricing          Fetch latest pricing from models.dev
  agent-tab --help                  This message
  agent-tab --version               Print version

Flags for status:
  --provider=<agent>                One-shot agent override
  --no-color / --color              Force color setting
  --offline                         Don't trigger background pricing refresh
                                    (also: AGENT_TAB_OFFLINE=1)

Wire into Claude Code's statusLine in ~/.claude/settings.json:
  "statusLine": { "type": "command", "command": "agent-tab" }
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const cmd = args[0];

  if (cmd === 'use') {
    return runUse(args.slice(1));
  }
  if (cmd === 'show') {
    return runShow();
  }
  if (cmd === 'update-pricing') {
    return runUpdatePricing();
  }
  if (!cmd || cmd === 'status' || cmd.startsWith('-')) {
    return runStatus(args.slice(cmd === 'status' ? 1 : 0));
  }

  process.stderr.write(`agent-tab: unknown command "${cmd}"\n\n${USAGE}`);
  return 2;
}

async function runStatus(args: string[]): Promise<number> {
  let provider: AgentName | null = null;
  let color: boolean | undefined;
  let offline = process.env.AGENT_TAB_OFFLINE === '1';
  for (const a of args) {
    if (a === '--no-color') color = false;
    else if (a === '--color') color = true;
    else if (a === '--offline') offline = true;
    else if (a.startsWith('--provider=')) {
      const v = a.slice('--provider='.length);
      if (isAgentName(v)) provider = v;
      else {
        process.stderr.write(`agent-tab: invalid --provider value "${v}"\n`);
        return 2;
      }
    }
  }

  if (!provider) {
    const cfg = await readConfig();
    provider = cfg.activeAgent;
  }

  const ctx = await readStdinContext();

  if (!offline) {
    await maybeTriggerBackgroundRefresh();
  }

  try {
    const snap = await getProvider(provider).snapshot(ctx);
    const line = formatSnapshot(snap, { color });
    process.stdout.write(line + '\n');
    return 0;
  } catch (err) {
    // Never crash the statusLine — print a quiet error and exit 0 so Claude Code shows it.
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`[${provider}] error: ${msg}\n`);
    return 0;
  }
}

async function maybeTriggerBackgroundRefresh(): Promise<void> {
  try {
    const cache = await readCache();
    const stale = !cache || cacheAgeMs(cache) > STALE_CACHE_MS;
    if (!stale) return;
    // Fire and forget — don't block the statusLine.
    const child = spawn(process.execPath, [process.argv[1] ?? '', 'update-pricing'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENT_TAB_BACKGROUND: '1' },
    });
    child.unref();
  } catch {
    // Never let refresh failure break the status path.
  }
}

async function runUpdatePricing(): Promise<number> {
  const background = process.env.AGENT_TAB_BACKGROUND === '1';
  try {
    const catalog = await fetchAndCache();
    if (!background) {
      const n = Object.keys(catalog.models).length;
      process.stdout.write(`updated: ${n} models cached from models.dev\n`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!background) {
      process.stderr.write(`agent-tab update-pricing: ${msg}\n`);
    }
    return 1;
  }
}

async function runUse(args: string[]): Promise<number> {
  const target = args[0];
  if (!target) {
    process.stderr.write(
      `agent-tab use: missing agent name. Choose one of: ${VALID_AGENTS.join(', ')}\n`,
    );
    return 2;
  }
  if (!isAgentName(target)) {
    process.stderr.write(
      `agent-tab use: "${target}" is not a valid agent. Choose one of: ${VALID_AGENTS.join(', ')}\n`,
    );
    return 2;
  }
  const next = await writeConfig({ activeAgent: target });
  process.stdout.write(`active agent: ${next.activeAgent}\n`);
  return 0;
}

async function runShow(): Promise<number> {
  const cfg = await readConfig();
  process.stdout.write(`${cfg.activeAgent}\n`);
  return 0;
}

async function readStdinContext(): Promise<StatusContext> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  const STDIN_TIMEOUT_MS = 200;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STDIN_TIMEOUT_MS));
  const collect = new Promise<void>((resolve, reject) => {
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', resolve);
    process.stdin.on('error', reject);
  });
  await Promise.race([collect, timeout]);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return extractContext(parsed);
  } catch {
    return {};
  }
}

function extractContext(obj: Record<string, unknown>): StatusContext {
  const ctx: StatusContext = {};
  if (typeof obj.session_id === 'string') ctx.sessionId = obj.session_id;
  if (typeof obj.transcript_path === 'string') ctx.transcriptPath = obj.transcript_path;
  const ws = obj.workspace as Record<string, unknown> | undefined;
  if (ws && typeof ws.current_dir === 'string') ctx.cwd = ws.current_dir;
  else if (typeof obj.cwd === 'string') ctx.cwd = obj.cwd;
  return ctx;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`agent-tab: fatal: ${msg}\n`);
    process.exit(1);
  },
);
