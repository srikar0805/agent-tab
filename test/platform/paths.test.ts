import { describe, expect, it } from 'vitest';
import {
  claudeCodePaths,
  codexPaths,
  geminiPaths,
  cursorPaths,
  SYNC_MARKERS,
} from '../../src/platform/paths';

describe('agent path resolvers', () => {
  it('returns absolute paths for each known agent', () => {
    for (const fn of [claudeCodePaths, codexPaths, geminiPaths, cursorPaths]) {
      const p = fn();
      expect(p.home).toBeTruthy();
      expect(p.home.length).toBeGreaterThan(1);
    }
  });

  it('respects CLAUDE_CONFIG_DIR override', () => {
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-claude';
    try {
      expect(claudeCodePaths().home).toBe('/tmp/custom-claude');
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });

  it('SYNC_MARKERS is non-empty and well-formed', () => {
    expect(SYNC_MARKERS.length).toBeGreaterThan(0);
    for (const m of SYNC_MARKERS) {
      expect(m.marker).toBeTruthy();
      expect(m.provider).toBeTruthy();
    }
  });
});
