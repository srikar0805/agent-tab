import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
  durationMs?: number;
}

export interface Conversation {
  id: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  createdAt: number;
  updatedAt: number;
}

const KEY = 'agentTab.activeConversation';

export class ConversationStore {
  constructor(private state: vscode.Memento) {}

  current(): Conversation {
    const c = this.state.get<Conversation>(KEY);
    if (c) return c;
    const fresh = this.fresh();
    void this.state.update(KEY, fresh);
    return fresh;
  }

  fresh(): Conversation {
    const cfg = vscode.workspace.getConfiguration('agentTab');
    return {
      id: cryptoRandom(),
      provider: cfg.get<string>('defaultProvider', 'anthropic'),
      model: cfg.get<string>('defaultModel', 'claude-sonnet-4-6'),
      messages: [],
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  async startNew() {
    await this.state.update(KEY, this.fresh());
  }

  async save(c: Conversation) {
    c.updatedAt = Date.now();
    await this.state.update(KEY, c);
  }
}

function cryptoRandom() {
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
