import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatRequest, StreamChunk, StreamResult } from './types';
import type { ChatMessage } from '../state';
import { estimateAnthropicHeuristic } from '../tokens';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client?: Anthropic;

  constructor(private getKey: () => Promise<string | undefined>) {}

  private async ensure() {
    if (this.client) return this.client;
    const apiKey = await this.getKey();
    if (!apiKey) throw new Error('Anthropic API key not set. Run "Agent Tab: Set API Key for Provider...".');
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async listModels() {
    return ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
  }

  async countInputTokens(model: string, messages: ChatMessage[]): Promise<number> {
    try {
      const c = await this.ensure();
      const r = await c.messages.countTokens({
        model,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        system: messages.find((m) => m.role === 'system')?.content
      });
      return r.input_tokens;
    } catch {
      return estimateAnthropicHeuristic(messages);
    }
  }

  async streamChat(
    req: ChatRequest,
    onDelta: (c: StreamChunk) => void,
    signal: AbortSignal
  ): Promise<StreamResult> {
    const c = await this.ensure();
    const system = req.system ?? req.messages.find((m) => m.role === 'system')?.content;
    const userAndAssistant = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = c.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system,
        messages: userAndAssistant,
        temperature: req.temperature
      },
      { signal }
    );

    let text = '';
    stream.on('text', (delta: string) => {
      text += delta;
      onDelta({ text: delta });
    });

    const final = await stream.finalMessage();
    const usage = final.usage ?? { input_tokens: 0, output_tokens: 0 };
    return {
      text,
      usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
    };
  }
}
