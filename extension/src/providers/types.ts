import type { ChatMessage } from '../state';

export interface StreamChunk {
  text: string;
}

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamResult {
  text: string;
  usage: StreamUsage;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  system?: string;
  maxOutputTokens: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  countInputTokens(model: string, messages: ChatMessage[]): Promise<number>;
  streamChat(
    req: ChatRequest,
    onDelta: (chunk: StreamChunk) => void,
    signal: AbortSignal
  ): Promise<StreamResult>;
  listModels(): Promise<string[]>;
}
