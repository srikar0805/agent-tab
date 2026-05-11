import type { Database } from 'better-sqlite3';
import type { ProviderId } from '../platform/paths';

export interface ProviderRollup {
  provider: ProviderId;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  premium_requests: number;
  event_count: number;
}

export interface DashboardSnapshot {
  windowStartMs: number;
  windowEndMs: number;
  totals: {
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    premium_requests: number;
  };
  perProvider: ProviderRollup[];
  unresolvedIssues: number;
}

export type Window = 'today' | 'week' | 'month';

/**
 * Compute the [start, end) of the requested window in the user's local TZ
 * (§17 Edge Cases — TZ for "today" boundary).
 *
 * "today" = local-midnight to now
 * "week"  = monday-of-this-week local-midnight to now
 * "month" = first-of-this-month local-midnight to now
 */
export function windowBounds(window: Window, now = new Date()): { start: number; end: number } {
  const end = now.getTime();
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  if (window === 'today') {
    return { start: local.getTime(), end };
  }
  if (window === 'week') {
    const day = local.getDay(); // 0 = Sun
    const offset = day === 0 ? 6 : day - 1; // ISO week starts Monday
    local.setDate(local.getDate() - offset);
    return { start: local.getTime(), end };
  }
  // month
  local.setDate(1);
  return { start: local.getTime(), end };
}

export function getDashboardSnapshot(db: Database, window: Window): DashboardSnapshot {
  const { start, end } = windowBounds(window);

  const perProvider = db
    .prepare(
      `SELECT provider,
              COALESCE(SUM(input_tokens), 0)          AS input_tokens,
              COALESCE(SUM(output_tokens), 0)         AS output_tokens,
              COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
              COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens,
              SUM(cost_usd)                           AS cost_usd,
              COALESCE(SUM(premium_requests), 0)      AS premium_requests,
              COUNT(*)                                AS event_count
         FROM events
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY provider`,
    )
    .all(start, end) as ProviderRollup[];

  const totals = perProvider.reduce(
    (acc, r) => ({
      cost_usd: acc.cost_usd + (r.cost_usd ?? 0),
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      premium_requests: acc.premium_requests + r.premium_requests,
    }),
    { cost_usd: 0, input_tokens: 0, output_tokens: 0, premium_requests: 0 },
  );

  const issuesRow = db
    .prepare('SELECT COUNT(*) AS n FROM collector_issues WHERE resolved_at IS NULL')
    .get() as { n: number };

  return {
    windowStartMs: start,
    windowEndMs: end,
    totals,
    perProvider,
    unresolvedIssues: issuesRow.n,
  };
}
