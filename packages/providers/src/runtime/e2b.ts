
import { IRuntimeProvider, RuntimeConfig, RuntimeSession, ProviderInfo } from '../interfaces';
import { Sandbox } from 'e2b';

export class E2BRuntimeProvider implements IRuntimeProvider {
  info: ProviderInfo = {
    id: 'runtime-e2b',
    type: 'runtime',
    name: 'E2B',
    version: '0.1.0'
  };

  private apiKey?: string;

  constructor(config: { apiKey?: string } = {}) {
    this.apiKey = config.apiKey || process.env.E2B_API_KEY;
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      console.warn('E2B_API_KEY not set for E2BRuntimeProvider');
    }
  }

  async shutdown(): Promise<void> {}

  async createSession(config: RuntimeConfig): Promise<RuntimeSession> {
    const template = config.template || 'base';
    const sandbox = await Sandbox.create({
      template,
      apiKey: this.apiKey,
      ...config.options
    });

    return {
      id: sandbox.id,
      status: 'running',
      metadata: {
        template,
        sandboxUrl: sandbox.getHost()
      }
    };
  }

  async exec(sessionId: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sandbox = await Sandbox.connect(sessionId, { apiKey: this.apiKey });
    const result = await sandbox.commands.run(`${command} ${args.join(' ')}`);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const sandbox = await Sandbox.connect(sessionId, { apiKey: this.apiKey });
    await sandbox.kill();
  }

  async checkpointSession(sessionId: string): Promise<Buffer> {
    // E2B doesn't support traditional checkpointing in the public SDK yet in the same way.
    // For now, we'll return the sessionId as the "checkpoint" if we want to "resume" it.
    // Or we might just say it's not supported.
    return Buffer.from(sessionId);
  }

  async restoreSession(checkpoint: Buffer): Promise<RuntimeSession> {
    const sessionId = checkpoint.toString();
    const sandbox = await Sandbox.connect(sessionId, { apiKey: this.apiKey });
    return {
      id: sandbox.id,
      status: 'running',
      metadata: {
        resumed: true
      }
    };
  }
}
