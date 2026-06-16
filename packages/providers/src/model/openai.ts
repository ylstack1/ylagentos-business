
import { IModelProvider, Message, ModelConfig, ProviderInfo } from '@yl/types';

export class OpenAIProvider implements IModelProvider {
  info: ProviderInfo = {
    id: 'model-openai',
    type: 'model',
    name: 'OpenAI',
    version: '0.1.0'
  };

  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string, baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async chat(messages: Message[], config: ModelConfig): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        ...config,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async *streamChat(messages: Message[], config: ModelConfig): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        ...config,
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No body in response');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const content = line.slice(6);
          if (content === '[DONE]') return;
          try {
            const data = JSON.parse(content);
            const text = data.choices[0]?.delta?.content;
            if (text) yield text;
          } catch (e) {
            // Ignore parse errors for partial lines
          }
        }
      }
    }
  }
}
