/**
 * Thin typed wrapper around the VSCode webview message bus.
 */

interface VsCodeApi {
  postMessage: (msg: unknown) => void;
  getState: <T>() => T | undefined;
  setState: <T>(state: T) => void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cached: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (cached) return cached;
  if (typeof window.acquireVsCodeApi !== 'function') {
    // Running outside VSCode (e.g. `vite dev` standalone preview).
    cached = {
      postMessage: (m) => console.log('[mock postMessage]', m),
      getState: () => undefined,
      setState: () => {},
    };
    return cached;
  }
  cached = window.acquireVsCodeApi();
  return cached;
}

export type Window = 'today' | 'week' | 'month';

export interface ProviderRollup {
  provider: string;
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

export type HostMessage =
  | { type: 'snapshot'; window: Window; snapshot: DashboardSnapshot };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestSnapshot'; window: Window }
  | { type: 'refresh'; window: Window }
  | { type: 'launchAgent' };

export function postToHost(msg: WebviewMessage): void {
  getVsCodeApi().postMessage(msg);
}
