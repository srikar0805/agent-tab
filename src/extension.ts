import * as vscode from 'vscode';
import { openStore, type Store } from './store/db';
import { getDashboardSnapshot, type Window } from './store/queries';
import { CollectorManager } from './collectors/manager';
import { StatusBarController } from './ui/statusBar';
import { SidebarProvider } from './ui/sidebarProvider';
import { registerCommands } from './commands';

let store: Store | undefined;
let statusBar: StatusBarController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('Coding Agent Monitor', { log: true });
  context.subscriptions.push(log);

  // 1. Open the SQLite store. This may throw if globalStorage is on a sync root.
  const storageDir = context.globalStorageUri.fsPath;
  try {
    store = openStore({ storageDir });
    log.info(`store opened at ${store.dbPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`failed to open store: ${msg}`);
    void vscode.window.showErrorMessage(`Coding Agent Monitor: ${msg}`);
    return;
  }

  // 2. Collector manager. Phase 1 registers no collectors; phase 2+ adds them.
  const collectors = new CollectorManager();

  // 3. Status bar.
  statusBar = new StatusBarController();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // 4. Sidebar webview.
  const sidebar = new SidebarProvider(context.extensionUri, {
    getSnapshot: (w: Window) => getDashboardSnapshot(store!.db, w),
    refreshNow: async () => {
      await runCollectors();
    },
    launchAgent: async () => {
      await vscode.commands.executeCommand('codingAgentMonitor.launchAgent');
    },
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar),
  );

  // 5. Commands.
  registerCommands(context, {
    store: store,
    collectors,
    sidebar,
    refreshNow: async () => {
      await runCollectors();
    },
  });

  // 6. Initial snapshot push to status bar.
  pushSnapshot();

  // 7. Polling. The interval is configurable; phase 1 has nothing to poll, but
  //    we wire the loop so phase 2 only needs to register collectors.
  const interval = setInterval(
    () => {
      void runCollectors();
    },
    Math.max(15, getPollInterval()) * 1000,
  );
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  log.info('coding-agent-monitor activated');

  async function runCollectors(): Promise<void> {
    if (!store) return;
    const list = collectors.list();
    if (list.length === 0) {
      // Nothing registered yet; just refresh the snapshot view.
      pushSnapshot();
      sidebar.pushUpdate();
      return;
    }
    // Real collection happens in phase 2+. Phase 1 just runs the no-op loop.
    pushSnapshot();
    sidebar.pushUpdate();
  }
}

export function deactivate(): void {
  store?.close();
  store = undefined;
  statusBar?.dispose();
  statusBar = undefined;
}

function pushSnapshot(): void {
  if (!store || !statusBar) return;
  const snapshot = getDashboardSnapshot(store.db, 'today');
  statusBar.update(snapshot);
}

function getPollInterval(): number {
  const cfg = vscode.workspace.getConfiguration('codingAgentMonitor');
  return cfg.get<number>('pollIntervalSeconds', 60);
}
