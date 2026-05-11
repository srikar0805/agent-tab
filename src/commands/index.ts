import * as vscode from 'vscode';
import type { CollectorManager } from '../collectors/manager';
import type { Store } from '../store/db';
import type { SidebarProvider } from '../ui/sidebarProvider';

export interface CommandDeps {
  store: Store;
  collectors: CollectorManager;
  sidebar: SidebarProvider;
  refreshNow: () => Promise<void>;
}

const NOT_YET = (name: string) =>
  vscode.window.showInformationMessage(
    `${name} — coming in a later phase. See DESIGN.md §15 for the implementation roadmap.`,
  );

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codingAgentMonitor.openDashboard', async () => {
      await vscode.commands.executeCommand('codingAgentMonitor.dashboard.focus');
    }),

    vscode.commands.registerCommand('codingAgentMonitor.refreshNow', async () => {
      await deps.refreshNow();
      vscode.window.setStatusBarMessage('Coding Agent Monitor: refreshed', 2000);
    }),

    vscode.commands.registerCommand('codingAgentMonitor.launchAgent', async () => {
      const available = deps.collectors.list();
      if (available.length === 0) {
        await NOT_YET('Launch Agent…');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        available.map((c) => ({ label: c.displayName, id: c.id })),
        { title: 'Launch which agent?', placeHolder: 'Select an agent' },
      );
      if (!pick) return;
      const collector = deps.collectors.get(pick.id);
      if (!collector) return;
      const profiles = await collector.listProfiles();
      const profile = profiles[0]; // phase 1: just first profile; phase 6 adds picker
      if (!profile) {
        vscode.window.showWarningMessage(
          `No profiles found for ${collector.displayName}. Sign in to the agent first.`,
        );
        return;
      }
      const spec = collector.buildLaunchSpec(profile, {});
      if (!spec) {
        vscode.window.showWarningMessage(
          `${collector.displayName} doesn't yet support launch from this extension.`,
        );
        return;
      }
      const term = vscode.window.createTerminal({
        name: `${collector.displayName} (${profile.display_name})`,
        env: spec.env,
      });
      term.sendText(`${spec.command} ${spec.args.join(' ')}`);
      term.show();
    }),

    vscode.commands.registerCommand('codingAgentMonitor.setQuotas', () => NOT_YET('Set Quota Caps')),
    vscode.commands.registerCommand('codingAgentMonitor.exportUsage', () => NOT_YET('Export Usage')),
    vscode.commands.registerCommand('codingAgentMonitor.importUsage', () => NOT_YET('Import Usage')),
    vscode.commands.registerCommand('codingAgentMonitor.updatePricing', () =>
      NOT_YET('Update Pricing Table'),
    ),
    vscode.commands.registerCommand('codingAgentMonitor.addCustomAgent', () =>
      NOT_YET('Add Custom Agent'),
    ),
  );
}
