import type { UsageCollector } from './types';

/**
 * Coordinates collector lifecycle. In phase 1 this is a stub — no concrete
 * collectors are registered yet. Phase 2 (§15) adds the Claude Code collector
 * and exercises this end-to-end.
 */
export class CollectorManager {
  private collectors = new Map<string, UsageCollector>();

  register(collector: UsageCollector): void {
    this.collectors.set(collector.id, collector);
  }

  list(): UsageCollector[] {
    return [...this.collectors.values()];
  }

  get(id: string): UsageCollector | undefined {
    return this.collectors.get(id);
  }
}
