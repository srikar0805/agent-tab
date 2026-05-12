import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, configPath } from '../src/config.js';

let tmp: string;
let prevXdg: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'agent-tab-cfg-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(tmp, { recursive: true, force: true });
});

describe('config', () => {
  it('returns the default when no config file exists', async () => {
    const cfg = await readConfig();
    expect(cfg.activeAgent).toBe('claude');
  });

  it('writes and reads back the active agent', async () => {
    await writeConfig({ activeAgent: 'codex' });
    expect((await readConfig()).activeAgent).toBe('codex');
    await writeConfig({ activeAgent: 'gemini' });
    expect((await readConfig()).activeAgent).toBe('gemini');
  });

  it('falls back to default when stored value is invalid', async () => {
    const path = configPath();
    await mkdir(join(tmp, 'agent-tab'), { recursive: true });
    await writeFile(path, JSON.stringify({ activeAgent: 'bogus' }), 'utf8');
    expect((await readConfig()).activeAgent).toBe('claude');
  });

  it('falls back to default when file is malformed JSON', async () => {
    const path = configPath();
    await mkdir(join(tmp, 'agent-tab'), { recursive: true });
    await writeFile(path, 'not-json', 'utf8');
    await expect(readConfig()).rejects.toThrow();
  });

  it('configPath honors XDG_CONFIG_HOME', () => {
    expect(configPath()).toBe(join(tmp, 'agent-tab', 'config.json'));
  });
});
