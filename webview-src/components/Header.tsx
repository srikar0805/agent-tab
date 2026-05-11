import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib/utils';
import type { Window } from '../lib/vscode';

interface Props {
  window: Window;
  onWindowChange: (w: Window) => void;
  onRefresh: () => void;
  unresolvedIssues: number;
  onOpenIssues: () => void;
}

const TABS: ReadonlyArray<{ id: Window; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export function Header({
  window,
  onWindowChange,
  onRefresh,
  unresolvedIssues,
  onOpenIssues,
}: Props) {
  return (
    <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg px-3 pb-3 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded border border-border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onWindowChange(t.id)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                window === t.id
                  ? 'bg-btn-bg text-btn-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenIssues}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors',
              unresolvedIssues > 0 ? 'text-warning hover:bg-btn-secondary-bg' : 'text-fg-muted hover:text-fg',
            )}
            title={
              unresolvedIssues > 0
                ? `${unresolvedIssues} unresolved issue${unresolvedIssues === 1 ? '' : 's'}`
                : 'No issues'
            }
          >
            <AlertCircle className="h-3 w-3" aria-hidden />
            Issues
            {unresolvedIssues > 0 ? (
              <span className="ml-0.5 rounded bg-warning/20 px-1 text-[10px] text-warning">
                {unresolvedIssues}
              </span>
            ) : null}
          </button>
        </div>

        <Button variant="ghost" onClick={onRefresh} title="Refresh now" aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </header>
  );
}
