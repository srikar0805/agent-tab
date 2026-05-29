import * as vscode from 'vscode';
import type { LLMProvider, ChatRequest, StreamChunk, StreamResult } from './types';
import type { ChatMessage } from '../state';
import { estimateOllamaTokens } from '../tokens';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;

  private base() {
    return vscode.workspace.getConfiguration('agentTab').get<string>('ollama.baseUrl', 'http://localhost:11434');
  }

  async listModels(): Promise<string[]> {
    try {
      const r = await fetch(`${this.base()}/api/tags`);
      if (!r.ok) throw new Error(`${r.status}`);
      const j: any = await r.json();
      return (j.models ?? []).map((m: any) => m.name);
    } catch {
      const def = vscode.workspace.getConfiguration('agentTab').get<string>('ollama.defaultModel', 'llama3.2');
      return [def];
    }
  }

  async countInputTokens(_model: string, messages: ChatMessage[]): Promise<number> {
    return estimateOllamaTokens(messages);
  }

  async streamChat(
    req: ChatRequest,
    onDelta: (c: StreamChunk) => void,
    signal: AbortSignal
  ): Promise<StreamResult> {
    const url = `${this.base()}/api/chat`;
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        num_predict: req.maxOutputTokens,
        temperature: req.temperature ?? 0.7
      }
    });

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal
    });

    if (!r.ok || !r.body) throw new Error(`Ollama HTTP ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const piece = j?.message?.content ?? '';
          if (piece) {
            text += piece;
            onDelta({ text: piece });
          }
          if (j.done) {
            usage = {
              inputTokens: j.prompt_eval_count ?? 0,
              outputTokens: j.eval_count ?? 0
            };
          }
        } catch {
          // tolerate partial line
        }
      }
    }

    return { text, usage };
  }
}
