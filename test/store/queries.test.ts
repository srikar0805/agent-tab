import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../src/store/migrations';
import { getDashboardSnapshot, windowBounds } from '../../src/store/queries';

function freshDb() {
  const db = new Database(':memory:');
  applyMigrations(db);
  return db;
}

describe('windowBounds', () => {
  it('today starts at local midnight', () => {
    const noon = new Date('2026-05-10T12:34:56');
    const { start, end } = windowBounds('today', noon);
    expect(end - start).toBeGreaterThan(0);
    expect(end - start).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('week always returns at least today', () => {
    const noon = new Date('2026-05-10T12:34:56');
    const { start, end } = windowBounds('week', noon);
    expect(start).toBeLessThanOrEqual(noon.getTime());
    expect(end).toBe(noon.getTime());
  });

  it('month starts on the 1st', () => {
    const noon = new Date('2026-05-10T12:34:56');
    const { start } = windowBounds('month', noon);
    const startDate = new Date(start);
    expect(startDate.getDate()).toBe(1);
  });
});

describe('getDashboardSnapshot', () => {
  it('returns zero totals on an empty DB', () => {
    const db = freshDb();
    const snap = getDashboardSnapshot(db, 'today');
    expect(snap.totals.cost_usd).toBe(0);
    expect(snap.perProvider).toEqual([]);
    expect(snap.unresolvedIssues).toBe(0);
  });

  it('sums per-provider rollups', () => {
    const db = freshDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO events (id, provider, profile_id, session_id, workspace_path, timestamp, model,
                           input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                           cost_usd, premium_requests, raw_meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('evt1', 'claude-code', 'p1', 's1', null, now, 'claude-sonnet-4-6', 100, 200, 0, 50, 0.123, 0, '{}');
    db.prepare(
      `INSERT INTO events (id, provider, profile_id, session_id, workspace_path, timestamp, model,
                           input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                           cost_usd, premium_requests, raw_meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('evt2', 'codex', 'p2', 's2', null, now, 'gpt-5-codex', 50, 75, 0, 0, 0.05, 0, '{}');

    const snap = getDashboardSnapshot(db, 'today');
    expect(snap.totals.cost_usd).toBeCloseTo(0.173, 5);
    expect(snap.perProvider).toHaveLength(2);
    const claude = snap.perProvider.find((p) => p.provider === 'claude-code')!;
    expect(claude.input_tokens).toBe(100);
    expect(claude.output_tokens).toBe(200);
  });

  it('counts unresolved collector issues', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO collector_issues (id, provider, ts, kind, message, source_path, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('i1', 'cursor', Date.now(), 'schema', 'schema fingerprint mismatch', null, null);
    db.prepare(
      `INSERT INTO collector_issues (id, provider, ts, kind, message, source_path, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('i2', 'codex', Date.now(), 'parse', 'truncated json', null, Date.now());

    const snap = getDashboardSnapshot(db, 'today');
    expect(snap.unresolvedIssues).toBe(1);
  });
});
