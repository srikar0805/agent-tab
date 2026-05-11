import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import type { DashboardSnapshot, Window } from '../store/queries';

export interface SidebarHandlers {
  /** Called when the webview asks for a fresh snapshot. */
  getSnapshot: (window: Window) => DashboardSnapshot;
  /** Called when the user clicks the Refresh button. */
  refreshNow: () => Promise<void>;
  /** Called when the user clicks the Launch Agent button. */
  launchAgent: () => Promise<void>;
}

/**
 * Hosts the React webview that renders the dashboard. All host↔webview
 * communication happens via postMessage; types are exchanged informally for
 * now and will be tightened with a shared protocol module in a later phase.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codingAgentMonitor.dashboard';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: SidebarHandlers,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready':
          this.postSnapshot('today');
          return;
        case 'requestSnapshot':
          this.postSnapshot((msg.window as Window) ?? 'today');
          return;
        case 'refresh':
          await this.handlers.refreshNow();
          this.postSnapshot((msg.window as Window) ?? 'today');
          return;
        case 'launchAgent':
          await this.handlers.launchAgent();
          return;
        default:
          // Unknown message — log for diagnostics, ignore.
          console.warn('[coding-agent-monitor] unknown webview message', msg);
      }
    });
  }

  /** External nudge — used after a collector run or settings change. */
  pushUpdate(window: Window = 'today'): void {
    this.postSnapshot(window);
  }

  private postSnapshot(window: Window): void {
    if (!this.view) return;
    const snapshot = this.handlers.getSnapshot(window);
    this.view.webview.postMessage({ type: 'snapshot', window, snapshot });
  }

  private renderHtml(webview: vscode.Webview): string {
    const webviewDir = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'index.css'));
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    // Vite emits an index.html we could use, but we want full control of nonce/CSP,
    // so we hand-render a thin shell that loads the built bundle.
    let template: string;
    try {
      template = readFileSync(
        vscode.Uri.joinPath(webviewDir, 'index.html').fsPath,
        'utf8',
      );
    } catch {
      template = '';
    }
    void template; // template is loaded for parity-checking in development; we render our own shell

    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Coding Agent Monitor</title>
  </head>
  <body class="bg-bg text-fg">
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
