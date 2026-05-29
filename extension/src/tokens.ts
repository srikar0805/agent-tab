import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import type { ChatMessage } from './state';

export function estimateOpenAITokens(model: string, messages: ChatMessage[]): number {
  const enc = /^(gpt-4o|gpt-5|o1|o3|o4|gpt-4\.1)/.test(model) ? encodeO200k : encodeCl100k;
  let n = 0;
  for (const m of messages) {
    n += 4;
    n += enc(m.role).length;
    n += enc(m.content).length;
  }
  return n + 2;
}

export function estimateAnthropicHeuristic(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += Math.ceil((m.content.length + m.role.length + 8) / 3.5);
  }
  return n;
}

export function estimateOllamaTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length + m.role.length + 8;
  }
  return Math.ceil(chars / 4);
}
