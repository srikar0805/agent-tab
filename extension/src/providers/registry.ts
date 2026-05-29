import type { LLMProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import type { Secrets } from '../secrets';

export function buildProviders(secrets: Secrets): Record<string, LLMProvider> {
  return {
    anthropic: new AnthropicProvider(() => secrets.get('anthropic')),
    openai: new OpenAIProvider(() => secrets.get('openai')),
    gemini: new GeminiProvider(() => secrets.get('gemini')),
    ollama: new OllamaProvider()
  };
}
