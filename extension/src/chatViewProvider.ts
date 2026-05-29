import * as vscode from 'vscode';
import { Secrets } from './secrets';
import { BudgetTracker } from './budget';
import { ConversationStore, ChatMessage, Conversation } from './state';
import { buildProviders } from './providers/registry';
import type { LLMProvider } from './providers/types';
import { computeCostUSD, priceFor } from './pricing';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'agentTabChat.view';

  private view?: vscode.WebviewView;
  private abort?: AbortController;
  private providers: Record<string, LLMProvider>;

  constructor(
    private ctx: vscode.ExtensionContext,
    private secrets: Secrets,
    private budget: BudgetTracker,
    private conv: ConversationStore
  ) {
    this.providers = buildProviders(secrets);
  }

  refreshState() {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'state', payload: this.snapshot() });
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')]
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === 'init') {
          this.refreshState();
          return;
        }
        if (msg.type === 'switchModel') {
          await this.switchModel(msg.provider, msg.model);
          return;
        }
        if (msg.type === 'newConversation') {
          await this.conv.startNew();
          this.refreshState();
          return;
        }
        if (msg.type === 'cancel') {
          this.abort?.abort();
          return;
        }
        if (msg.type === 'estimate') {
          await this.estimate(msg.draft);
          return;
        }
        if (msg.type === 'send') {
          await this.send(msg.draft);
          return;
        }
        if (msg.type === 'retry') {
          await this.retry();
          return;
        }
        if (msg.type === 'setApiKey') {
          await vscode.commands.executeCommand('agentTabChat.setApiKey');
          return;
        }
        if (msg.type === 'openSetting' && typeof msg.key === 'string') {
          await vscode.commands.executeCommand('workbench.action.openSettings', msg.key);
          return;
        }
      } catch (e: any) {
        view.webview.postMessage({ type: 'error', message: this.humanizeError(e) });
      }
    });
  }

  private async switchModel(provider: string, model: string) {
    const c = this.conv.current();
    c.provider = provider;
    c.model = model;
    await this.conv.save(c);
    this.refreshState();
  }

  private async estimate(draft: string) {
    const c = this.conv.current();
    const p = this.providers[c.provider];
    const msgs: ChatMessage[] = [...this.systemMessage(), ...c.messages, { role: 'user', content: draft }];
    const tokens = await p.countInputTokens(c.model, msgs);
    this.view?.webview.postMessage({ type: 'estimate', tokens });
  }

  private systemMessage(): ChatMessage[] {
    const s = vscode.workspace.getConfiguration('agentTab').get<string>('systemPrompt', '');
    return s ? [{ role: 'system', content: s }] : [];
  }

  private async send(draft: string) {
    const c = this.conv.current();
    const p = this.providers[c.provider];
    const maxOut = vscode.workspace.getConfiguration('agentTab').get<number>('maxOutputTokens', 4096);

    c.messages.push({ role: 'user', content: draft });
    await this.conv.save(c);
    this.view?.webview.postMessage({ type: 'appendUser', content: draft });

    this.abort = new AbortController();
    this.view?.webview.postMessage({ type: 'streamStart' });
    const startedAt = Date.now();
    let acc = '';
    let usage = { inputTokens: 0, outputTokens: 0 };

    try {
      const res = await p.streamChat(
        {
          model: c.model,
          messages: [...this.systemMessage(), ...c.messages],
          maxOutputTokens: maxOut
        },
        (chunk) => {
          acc += chunk.text;
          this.view?.webview.postMessage({ type: 'streamDelta', text: chunk.text });
        },
        this.abort.signal
      );

      acc = res.text;
      usage = res.usage;
    } catch (e: any) {
      this.view?.webview.postMessage({ type: 'error', message: this.humanizeError(e) });
      c.messages.pop();
      await this.conv.save(c);
      this.refreshState();
      return;
    }

    c.messages.push({ role: 'assistant', content: acc });
    c.inputTokens += usage.inputTokens;
    c.outputTokens += usage.outputTokens;
    const turnCost = computeCostUSD(c.model, usage.inputTokens, usage.outputTokens);
    c.costUSD += turnCost;
    c.messages[c.messages.length - 1] = {
      role: 'assistant',
      content: acc,
      provider: c.provider,
      model: c.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUSD: turnCost,
      durationMs: Date.now() - startedAt
    };
    await this.conv.save(c);
    await this.budget.add(turnCost);

    this.view?.webview.postMessage({ type: 'streamEnd', usage, turnCost });
    this.refreshState();

    const b = this.budget.read();
    if (b.dayLimit > 0 && b.daySpend / b.dayLimit >= 0.95) {
      void vscode.window.showWarningMessage('Agent Tab daily budget is above 95%.');
    }

    const totalUsed = c.inputTokens + c.outputTokens;
    const cw = priceFor(c.model).cw;
    if (cw > 0 && totalUsed / cw >= 0.9) {
      void vscode.window.showInformationMessage('Conversation is above 90% of context window. Consider starting a new conversation.');
    }
  }

  private async retry() {
    const c = this.conv.current();
    const last = c.messages[c.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    c.messages.pop();
    await this.conv.save(c);
    this.refreshState();
    await this.sendFromConversation(c);
  }

  private async sendFromConversation(c: Conversation) {
    const p = this.providers[c.provider];
    const maxOut = vscode.workspace.getConfiguration('agentTab').get<number>('maxOutputTokens', 4096);
    this.abort = new AbortController();
    this.view?.webview.postMessage({ type: 'streamStart' });
    const startedAt = Date.now();
    let acc = '';
    let usage = { inputTokens: 0, outputTokens: 0 };

    try {
      const res = await p.streamChat(
        {
          model: c.model,
          messages: [...this.systemMessage(), ...c.messages],
          maxOutputTokens: maxOut
        },
        (chunk) => {
          acc += chunk.text;
          this.view?.webview.postMessage({ type: 'streamDelta', text: chunk.text });
        },
        this.abort.signal
      );

      acc = res.text;
      usage = res.usage;
    } catch (e: any) {
      this.view?.webview.postMessage({ type: 'error', message: this.humanizeError(e) });
      this.refreshState();
      return;
    }

    c.messages.push({
      role: 'assistant',
      content: acc,
      provider: c.provider,
      model: c.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUSD: computeCostUSD(c.model, usage.inputTokens, usage.outputTokens),
      durationMs: Date.now() - startedAt
    });
    c.inputTokens += usage.inputTokens;
    c.outputTokens += usage.outputTokens;
    const turnCost = computeCostUSD(c.model, usage.inputTokens, usage.outputTokens);
    c.costUSD += turnCost;
    await this.conv.save(c);
    await this.budget.add(turnCost);

    this.view?.webview.postMessage({ type: 'streamEnd', usage, turnCost });
    this.refreshState();
  }

  private snapshot() {
    const c = this.conv.current();
    const b = this.budget.read();
    const pricing = priceFor(c.model);
    return {
      conversation: c,
      budget: b,
      contextWindow: pricing.cw,
      providers: Object.keys(this.providers),
      models: {
        anthropic: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
        openai: ['gpt-5.5', 'gpt-5.4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o3', 'o4-mini'],
        gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
        ollama: [vscode.workspace.getConfiguration('agentTab').get<string>('ollama.defaultModel', 'llama3.2')]
      }
    };
  }

  private humanizeError(err: unknown): string {
    const raw = String((err as any)?.message ?? err ?? 'Unknown error');
    if (/NOT_FOUND|not found/i.test(raw) && /gemini/i.test(raw)) {
      return 'Selected Gemini model is unavailable for this API key. Choose gemini-2.5-pro or gemini-2.5-flash.';
    }
    if (/API key not set/i.test(raw)) {
      return raw;
    }
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    return oneLine.length > 240 ? `${oneLine.slice(0, 240)}...` : oneLine;
  }

  private html(webview: vscode.Webview): string {
    const nonce = nonceFor();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'chat.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'chat.js'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `connect-src https: http://localhost:* http://127.0.0.1:*`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${cssUri}">
  <title>Agent Tab Chat</title>
</head>
<body>
<div class="panel-root">
  <header class="topbar" aria-label="Session">
    <div class="topbar-left">
      <span class="brand" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" opacity="0.18"/>
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor"/>
        </svg>
      </span>
      <span id="sessionTitle" class="session-title">New chat</span>
    </div>
    <div class="topbar-right">
      <button id="keyBtn" class="icon-btn" title="Set provider API key" aria-label="Set API key">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10.5 2a3.5 3.5 0 1 0 3.3 4.6L15 8l-1.2 1.2L13 9l-.8.8-.8-.8-.8.8H8.5v-1.7A3.5 3.5 0 1 1 10.5 2Zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fill="currentColor"/>
        </svg>
      </button>
      <button id="newBtn" class="icon-btn" title="New conversation" aria-label="New conversation">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v3l4-3.5L8 0v3a5 5 0 1 0 5 5h-1.5A3.5 3.5 0 1 1 8 4.5V3Z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  </header>

  <main id="messages" class="messages" aria-live="polite">
    <div id="emptyState" class="empty-state" hidden>
      <h1 class="empty-title">What are we building?</h1>
      <p id="emptySubtitle" class="empty-subtitle">Running locally — free, on your machine.</p>
      <div class="suggestions">
        <button class="suggestion" data-prompt="Explain this error in my terminal">
          <span class="suggestion-icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10v8H3z" stroke="currentColor" stroke-width="1.2"/><path d="M5 7l1.5 1.5L9 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          Explain this error in my terminal
        </button>
        <button class="suggestion" data-prompt="Refactor the selected function">
          <span class="suggestion-icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h6m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="8" r="1.4" fill="currentColor"/></svg>
          </span>
          Refactor the selected function
        </button>
        <button class="suggestion" data-prompt="Write tests for @currentFile">
          <span class="suggestion-icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 3h6l3 3v7H4z" stroke="currentColor" stroke-width="1.2"/><path d="M6 9l1.5 1.5L10 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          Write tests for @currentFile
        </button>
      </div>
    </div>
  </main>

  <section class="meterstrip" aria-label="Usage">
    <div class="ctx" title="Context window usage">
      <span class="ctx-label">Context</span>
      <span id="ctxText" class="ctx-text">0 / 0</span>
      <div class="ctx-bar"><div id="ctxBar" class="ctx-fill"></div></div>
    </div>
    <button id="dayPill" class="budget-pill" title="Daily budget" type="button">
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 5v3l2 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      <span id="dayText">$0 / $0</span>
    </button>
    <button id="monthPill" class="budget-pill" title="Monthly budget" type="button">
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M2.5 6h11M6 2.5v2M10 2.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      <span id="monthText">$0 / $0</span>
    </button>
  </section>

  <footer class="composer" role="form">
    <div class="composer-card">
      <textarea id="input" rows="1" placeholder="Ask anything, or describe what to build…"></textarea>
      <div class="composer-controls">
        <div class="controls-left">
          <label class="model-chip" for="modelSelect" title="Model">
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 5v6L8 14 2 11V5z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>
            <select id="modelSelect" aria-label="Model"></select>
            <svg class="chev" width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </label>
          <button id="attachBtn" class="icon-btn quiet" title="Attach (coming soon)" aria-label="Attach" disabled>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 5 6 9.5a2.121 2.121 0 0 0 3 3l5-5a3.5 3.5 0 0 0-5-5L4 7.5A5 5 0 0 0 11 14.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
          </button>
          <button id="slashBtn" class="icon-btn quiet" title="Slash command (coming soon)" aria-label="Slash command" disabled>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="m11 3-6 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="controls-right">
          <button id="sendBtn" class="send-btn" title="Send" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button id="cancelBtn" class="send-btn cancel" title="Stop" aria-label="Stop" hidden>
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="hint-row">
      <span id="modeHint" class="mode-hint">Local · ⌘↵ to send</span>
      <span id="status" class="status"></span>
    </div>
  </footer>
</div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function nonceFor() {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
