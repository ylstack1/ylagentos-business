
import { IProvider } from './provider';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ModelConfig {
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

export interface IModelProvider extends IProvider {
  chat(messages: Message[], config: ModelConfig): Promise<string>;
  streamChat(messages: Message[], config: ModelConfig): AsyncIterable<string>;
}
