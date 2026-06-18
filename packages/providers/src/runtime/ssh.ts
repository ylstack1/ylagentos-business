
import { IRuntimeProvider, RuntimeConfig, RuntimeSession, ProviderInfo } from '../interfaces';
import { NodeSSH } from 'node-ssh';

export class SSHRuntimeProvider implements IRuntimeProvider {
  info: ProviderInfo = {
    id: 'runtime-ssh',
    type: 'runtime',
    name: 'SSH',
    version: '0.1.0'
  };

  private connections: Map<string, NodeSSH> = new Map();

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    for (const ssh of this.connections.values()) {
      ssh.dispose();
    }
    this.connections.clear();
  }

  async createSession(config: RuntimeConfig): Promise<RuntimeSession> {
    const ssh = new NodeSSH();
    await ssh.connect({
      host: config.host,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      ...config.options
    });

    const sessionId = `ssh-${config.host}-${Math.random().toString(36).substring(7)}`;
    this.connections.set(sessionId, ssh);

    return {
      id: sessionId,
      status: 'running',
      metadata: {
        host: config.host,
        username: config.username
      }
    };
  }

  async exec(sessionId: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const ssh = this.connections.get(sessionId);
    if (!ssh) throw new Error(`SSH session ${sessionId} not found`);

    const result = await ssh.execCommand(`${command} ${args.join(' ')}`);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code ?? 0
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const ssh = this.connections.get(sessionId);
    if (ssh) {
      ssh.dispose();
      this.connections.delete(sessionId);
    }
  }

  async checkpointSession(sessionId: string): Promise<Buffer> {
    throw new Error('Checkpointing not supported for SSH runtime');
  }

  async restoreSession(checkpoint: Buffer): Promise<RuntimeSession> {
    throw new Error('Restoring not supported for SSH runtime');
  }
}
