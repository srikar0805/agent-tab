import OpenAI from 'openai';
import type { LLMProvider, ChatRequest, StreamChunk, StreamResult } from './types';
import type { ChatMessage } from '../state';
import { estimateOpenAITokens } from '../tokens';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  private client?: OpenAI;

  constructor(private getKey: () => Promise<string | undefined>) {}

  private async ensure() {
    if (this.client) return this.client;
    const apiKey = await this.getKey();
    if (!apiKey) throw new Error('OpenAI API key not set.');
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  async listModels() {
    return ['gpt-5.5', 'gpt-5.4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o3', 'o4-mini'];
  }

  async countInputTokens(model: string, messages: ChatMessage[]): Promise<number> {
    return estimateOpenAITokens(model, messages);
  }

  async streamChat(
    req: ChatRequest,
    onDelta: (c: StreamChunk) => void,
    signal: AbortSignal
  ): Promise<StreamResult> {
    const c = await this.ensure();
    const isReasoning = /^o\d|gpt-5/.test(req.model);
    const stream = await c.chat.completions.create(
      {
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        stream_options: { include_usage: true },
        ...(isReasoning
          ? { max_completion_tokens: req.maxOutputTokens }
          : { max_tokens: req.maxOutputTokens, temperature: req.temperature ?? 0.7 })
      },
      { signal }
    );

    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        onDelta({ text: delta });
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0
        };
      }
    }

    return { text, usage };
  }
}
