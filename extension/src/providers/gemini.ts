import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatRequest, StreamChunk, StreamResult } from './types';
import type { ChatMessage } from '../state';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  private ai?: GoogleGenAI;

  constructor(private getKey: () => Promise<string | undefined>) {}

  private async ensure() {
    if (this.ai) return this.ai;
    const apiKey = await this.getKey();
    if (!apiKey) throw new Error('Gemini API key not set.');
    this.ai = new GoogleGenAI({ apiKey });
    return this.ai;
  }

  async listModels() {
    return ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  }

  private toContents(messages: ChatMessage[]) {
    return messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  }

  async countInputTokens(model: string, messages: ChatMessage[]): Promise<number> {
    try {
      const ai = await this.ensure();
      const r = await ai.models.countTokens({ model, contents: this.toContents(messages) as any });
      return r.totalTokens ?? 0;
    } catch {
      let n = 0;
      for (const m of messages) n += Math.ceil(m.content.length / 4);
      return n;
    }
  }

  async streamChat(
    req: ChatRequest,
    onDelta: (c: StreamChunk) => void,
    _signal: AbortSignal
  ): Promise<StreamResult> {
    const ai = await this.ensure();
    const system = req.system ?? req.messages.find((m) => m.role === 'system')?.content;

    const response = await ai.models.generateContentStream({
      model: req.model,
      contents: this.toContents(req.messages) as any,
      config: {
        systemInstruction: system,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature
      }
    });

    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of response) {
      const t = chunk.text ?? '';
      if (t) {
        text += t;
        onDelta({ text: t });
      }
      const u = (chunk as any).usageMetadata;
      if (u) {
        usage = {
          inputTokens: u.promptTokenCount ?? usage.inputTokens,
          outputTokens: u.candidatesTokenCount ?? usage.outputTokens
        };
      }
    }

    return { text, usage };
  }
}
