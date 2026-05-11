import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyMigrations } from './migrations';
import { SYNC_MARKERS } from '../platform/paths';
import { readdirSync } from 'node:fs';

export interface OpenStoreOptions {
  /** Absolute path to the directory where usage.db should live (typically VSCode globalStorageUri). */
  storageDir: string;
}

export interface Store {
  db: Database.Database;
  dbPath: string;
  close: () => void;
}

/**
 * Opens (creating if necessary) the SQLite store at <storageDir>/usage.db.
 *
 * Refuses to open if storageDir lives under a known cloud-sync root — see §10.3
 * "Explicitly NOT supported" and §16 OQ3 in DESIGN.md. SQLite + Dropbox/iCloud
 * = WAL/SHM corruption.
 */
export function openStore(opts: OpenStoreOptions): Store {
  if (!existsSync(opts.storageDir)) {
    mkdirSync(opts.storageDir, { recursive: true });
  }

  const syncRoot = detectSyncRoot(opts.storageDir);
  if (syncRoot) {
    throw new Error(
      `Refusing to open SQLite store at ${opts.storageDir}: directory appears to live under a ${syncRoot} sync root. ` +
        'SQLite databases corrupt when synced via cloud-sync clients. See DESIGN.md §10.3.',
    );
  }

  const dbPath = join(opts.storageDir, 'usage.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  applyMigrations(db);

  return {
    db,
    dbPath,
    close: () => db.close(),
  };
}

/**
 * Walks up from `dir` looking for known cloud-sync markers. Returns the
 * provider name if found, or null. See SYNC_MARKERS in platform/paths.ts.
 */
export function detectSyncRoot(dir: string): string | null {
  let cur = dir;
  let prev = '';
  while (cur && cur !== prev) {
    try {
      const entries = readdirSync(cur);
      for (const { marker, provider } of SYNC_MARKERS) {
        if (entries.includes(marker)) return provider;
      }
    } catch {
      // ignore read errors and keep walking
    }
    prev = cur;
    cur = dirname(cur);
  }
  return null;
}
