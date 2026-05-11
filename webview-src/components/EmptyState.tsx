import { Activity, Sparkles, BarChart3, ShieldCheck } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';

interface Props {
  onRefresh: () => void;
  onLaunch: () => void;
}

export function EmptyState({ onRefresh, onLaunch }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <div className="rounded-full border border-border bg-card p-3">
          <Activity className="h-7 w-7 text-accent" aria-hidden />
        </div>
        <h2 className="text-base font-semibold text-fg">Coding Agent Monitor</h2>
        <p className="max-w-sm text-xs text-fg-muted">
          A unified view of token usage, cost, and plan-quota status across Claude Code,
          Codex CLI, Gemini CLI, GitHub Copilot, Cursor, and any custom agents you add.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <Button onClick={onRefresh} variant="primary">
            Scan for installed agents
          </Button>
          <Button onClick={onLaunch} variant="secondary">
            Launch agent…
          </Button>
        </div>
      </div>

      <Card>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          What you'll see once data flows
        </h3>
        <ul className="flex flex-col gap-2 text-xs">
          <FeatureRow
            icon={<BarChart3 className="h-4 w-4 text-accent" />}
            title="Daily / weekly / monthly totals"
            body="Cost and token counts per agent and per model, with quota bars where available."
          />
          <FeatureRow
            icon={<Sparkles className="h-4 w-4 text-accent" />}
            title="Per-account split"
            body="Sessions are tagged by the account/email they ran under — work vs personal at a glance."
          />
          <FeatureRow
            icon={<ShieldCheck className="h-4 w-4 text-accent" />}
            title="Local-first, privacy-respecting"
            body="All data stays on disk. No telemetry leaves your machine."
          />
        </ul>
      </Card>

      <p className="px-2 text-[11px] text-fg-muted">
        Phase 1 build · Collectors are wired in over phases 2–7. See <code>DESIGN.md</code> §15.
      </p>
    </div>
  );
}

function FeatureRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="font-medium text-fg">{title}</span>
        <span className="text-fg-muted"> — {body}</span>
      </span>
    </li>
  );
}
