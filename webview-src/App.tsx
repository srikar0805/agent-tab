import { useEffect, useState } from 'react';
import { postToHost, type DashboardSnapshot, type HostMessage, type Window } from './lib/vscode';
import { Header } from './components/Header';
import { TotalsBar } from './components/TotalsBar';
import { EmptyState } from './components/EmptyState';

const WINDOW_LABEL: Record<Window, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
};

export function App() {
  const [window, setWindow] = useState<Window>('today');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>) => {
      const msg = e.data;
      if (msg?.type === 'snapshot') {
        setSnapshot(msg.snapshot);
      }
    };
    addEventListener('message', onMessage);
    postToHost({ type: 'ready' });
    return () => removeEventListener('message', onMessage);
  }, []);

  const onWindowChange = (w: Window) => {
    setWindow(w);
    postToHost({ type: 'requestSnapshot', window: w });
  };

  const onRefresh = () => {
    postToHost({ type: 'refresh', window });
  };

  const onLaunch = () => {
    postToHost({ type: 'launchAgent' });
  };

  const isEmpty = !snapshot || snapshot.perProvider.length === 0;

  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <Header
        window={window}
        onWindowChange={onWindowChange}
        onRefresh={onRefresh}
        unresolvedIssues={snapshot?.unresolvedIssues ?? 0}
        onOpenIssues={() => {
          // Phase 1: no Issues view yet — focus the dashboard with Issues highlighted is a phase-12 task.
          console.info('[coding-agent-monitor] Issues tab not yet implemented (phase 12)');
        }}
      />

      <main className="flex flex-1 flex-col gap-3 pb-4">
        {snapshot && !isEmpty && <TotalsBar snapshot={snapshot} windowLabel={WINDOW_LABEL[window]} />}
        <div className="px-3">
          {isEmpty ? <EmptyState onRefresh={onRefresh} onLaunch={onLaunch} /> : null}
        </div>
      </main>
    </div>
  );
}
