import type { ProviderId } from '../platform/paths';

export interface UsageEvent {
  id: string;
  provider: ProviderId;
  profile_id: string;
  session_id: string;
  workspace_path: string | null;
  timestamp: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  premium_requests: number;
  raw_meta: Record<string, unknown>;
}

export interface Profile {
  id: string;
  provider: ProviderId;
  email: string | null;
  account_id: string | null;
  display_name: string;
  config_dir: string | null;
  env: Record<string, string>;
  created_at: number;
  last_seen_at: number;
}

export type QuotaWindow = 'daily' | 'weekly' | 'monthly';
export type QuotaUnit = 'tokens' | 'usd' | 'requests' | 'messages';
export type QuotaSource = 'api' | 'inferred-from-error' | 'user-configured';

export interface PlanQuota {
  provider: ProviderId;
  profile_id: string;
  window: QuotaWindow;
  used: number;
  limit: number;
  unit: QuotaUnit;
  fetched_at: number;
  source: QuotaSource;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CollectorContext {
  /** Lower bound for incremental collection. Collectors should be idempotent regardless. */
  since: Date;
  /**
   * Workspace folder paths the user currently has open. Collectors may use this to scope
   * results, but should never *require* a workspace.
   */
  workspaces: string[];
  /** Report a non-fatal issue (parse error, schema mismatch, etc.). Surfaces in the Issues tab. */
  reportIssue: (issue: {
    kind: 'parse' | 'schema' | 'network' | 'permission' | 'other';
    message: string;
    sourcePath?: string;
  }) => void;
}

export interface UsageCollector {
  readonly id: ProviderId;
  readonly displayName: string;

  isAvailable(): Promise<boolean>;
  listProfiles(): Promise<Profile[]>;
  collect(ctx: CollectorContext): Promise<UsageEvent[]>;
  getPlanQuotas(profile: Profile): Promise<PlanQuota[]>;
  buildLaunchSpec(
    profile: Profile,
    opts: { model?: string; cwd?: string },
  ): LaunchSpec | null;
}
