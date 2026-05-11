import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE events (
          id                    TEXT PRIMARY KEY,
          provider              TEXT NOT NULL,
          profile_id            TEXT NOT NULL,
          session_id            TEXT NOT NULL,
          workspace_path        TEXT,
          timestamp             INTEGER NOT NULL,
          model                 TEXT NOT NULL,
          input_tokens          INTEGER NOT NULL,
          output_tokens         INTEGER NOT NULL,
          cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
          cost_usd              REAL,
          premium_requests      INTEGER NOT NULL DEFAULT 0,
          raw_meta              TEXT
        );
        CREATE INDEX events_provider_ts ON events (provider, timestamp);
        CREATE INDEX events_profile_ts  ON events (profile_id, timestamp);

        CREATE TABLE profiles (
          id           TEXT PRIMARY KEY,
          provider     TEXT NOT NULL,
          email        TEXT,
          account_id   TEXT,
          display_name TEXT NOT NULL,
          config_dir   TEXT,
          env_json     TEXT,
          created_at   INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );

        CREATE TABLE collector_state (
          provider     TEXT NOT NULL,
          source_path  TEXT NOT NULL,
          byte_offset  INTEGER NOT NULL DEFAULT 0,
          last_run_at  INTEGER,
          PRIMARY KEY (provider, source_path)
        );

        CREATE TABLE plan_quotas (
          provider     TEXT NOT NULL,
          profile_id   TEXT NOT NULL,
          window       TEXT NOT NULL,
          used         REAL NOT NULL,
          limit_value  REAL NOT NULL,
          unit         TEXT NOT NULL,
          fetched_at   INTEGER NOT NULL,
          source       TEXT NOT NULL,
          PRIMARY KEY (provider, profile_id, window)
        );

        CREATE TABLE collector_issues (
          id           TEXT PRIMARY KEY,
          provider     TEXT NOT NULL,
          ts           INTEGER NOT NULL,
          kind         TEXT NOT NULL,
          message      TEXT NOT NULL,
          source_path  TEXT,
          resolved_at  INTEGER
        );
        CREATE INDEX collector_issues_unresolved
          ON collector_issues (resolved_at) WHERE resolved_at IS NULL;
      `);
    },
  },
];

export function applyMigrations(db: Database): { applied: number[]; current: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  // Refuse to start on a future schema (downgrade safety, see §17 Edge Cases).
  const maxKnown = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);
  const maxApplied = appliedRows.reduce((m, x) => Math.max(m, x.version), 0);
  if (maxApplied > maxKnown) {
    throw new Error(
      `Database schema version ${maxApplied} is newer than this extension version supports (${maxKnown}). ` +
        'Refusing to run to avoid corruption. Please upgrade the extension.',
    );
  }

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const newlyApplied: number[] = [];
  const apply = db.transaction((m: Migration) => {
    m.up(db);
    insertMigration.run(m.version, m.name, Date.now());
    newlyApplied.push(m.version);
  });

  for (const m of MIGRATIONS.sort((a, b) => a.version - b.version)) {
    if (!appliedSet.has(m.version)) {
      apply(m);
    }
  }

  return { applied: newlyApplied, current: maxKnown };
}
