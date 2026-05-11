import * as vscode from 'vscode';
import type { DashboardSnapshot } from '../store/queries';

/**
 * Status-bar item showing today's spend and a click-target for opening the
 * dashboard. Dot is appended when there are unresolved collector issues
 * (§OQ6 in DESIGN.md).
 */
export class StatusBarController {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'codingAgentMonitor.openDashboard';
    this.item.name = 'Coding Agent Monitor';
    this.update(null);
    this.item.show();
  }

  update(snapshot: DashboardSnapshot | null): void {
    if (!snapshot) {
      this.item.text = '$(graph) Agent Monitor';
      this.item.tooltip = 'Click to open the Coding Agent Monitor dashboard';
      this.item.backgroundColor = undefined;
      return;
    }
    const cost = formatCost(snapshot.totals.cost_usd);
    const issuesDot = snapshot.unresolvedIssues > 0 ? ' $(circle-filled)' : '';
    this.item.text = `$(graph) ${cost} today${issuesDot}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**Coding Agent Monitor**\n\n` +
        `Today: **${cost}** · ${formatTokens(snapshot.totals.input_tokens + snapshot.totals.output_tokens)} tokens\n\n` +
        (snapshot.unresolvedIssues > 0
          ? `\n_${snapshot.unresolvedIssues} unresolved issue${snapshot.unresolvedIssues === 1 ? '' : 's'} — click to open the Issues tab._`
          : '_All collectors healthy._'),
    );
    this.item.backgroundColor =
      snapshot.unresolvedIssues > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
