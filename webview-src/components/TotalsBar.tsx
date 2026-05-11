import { formatCost, formatTokens } from '../lib/utils';
import type { DashboardSnapshot } from '../lib/vscode';

interface Props {
  snapshot: DashboardSnapshot;
  windowLabel: string;
}

export function TotalsBar({ snapshot, windowLabel }: Props) {
  const tokens = snapshot.totals.input_tokens + snapshot.totals.output_tokens;
  return (
    <section className="flex flex-col gap-1 px-3 pt-3">
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">{windowLabel}</div>
      <div className="flex items-baseline gap-3">
        <div className="text-2xl font-semibold tabular-nums text-fg">
          {formatCost(snapshot.totals.cost_usd)}
        </div>
        <div className="text-xs tabular-nums text-fg-muted">
          {formatTokens(tokens)} tokens
          {snapshot.totals.premium_requests > 0 && (
            <> · {snapshot.totals.premium_requests} premium req</>
          )}
        </div>
      </div>
    </section>
  );
}
