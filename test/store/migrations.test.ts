import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, MIGRATIONS } from '../../src/store/migrations';

describe('applyMigrations', () => {
  it('creates the full schema on a fresh DB', () => {
    const db = new Database(':memory:');
    const result = applyMigrations(db);
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(result.current).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    for (const expected of [
      'collector_issues',
      'collector_state',
      'events',
      'plan_quotas',
      'profiles',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('is idempotent — second run applies nothing', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const second = applyMigrations(db);
    expect(second.applied).toEqual([]);
  });

  it('refuses to run when the DB is at a future schema version', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      9999,
      'future migration from a newer extension',
      Date.now(),
    );
    expect(() => applyMigrations(db)).toThrow(/newer than this extension/);
  });
});
