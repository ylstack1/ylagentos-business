
import { IRuntimeProvider, RuntimeConfig, RuntimeSession, ProviderInfo } from '../../interfaces';
import { spawn } from 'child_process';

export class DockerRuntimeProvider implements IRuntimeProvider {
  info: ProviderInfo = {
    id: 'runtime-docker',
    type: 'runtime',
    name: 'Docker',
    version: '0.1.0'
  };

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  private async execDocker(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn('docker', args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => stdout += data.toString());
      proc.stderr.on('data', (data) => stderr += data.toString());
      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
    });
  }

  async createSession(config: RuntimeConfig): Promise<RuntimeSession> {
    const image = config.image || 'ubuntu:latest';
    const name = `yl-session-${Math.random().toString(36).substring(7)}`;
    const args = ['run', '-d', '--name', name, image, 'tail', '-f', '/dev/null'];
    
    const result = await this.execDocker(args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Docker session: ${result.stderr}`);
    }

    return {
      id: name,
      status: 'running',
      metadata: { image }
    };
  }

  async exec(sessionId: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return await this.execDocker(['exec', sessionId, command, ...args]);
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.execDocker(['stop', sessionId]);
    await this.execDocker(['rm', sessionId]);
  }

  async checkpointSession(sessionId: string): Promise<Buffer> {
    // Docker checkpointing requires CRIU and experimental mode.
    // For now, we'll implement a 'commit' based checkpointing (image snapshot).
    const checkpointName = `${sessionId}-checkpoint`;
    await this.execDocker(['commit', sessionId, checkpointName]);
    return Buffer.from(checkpointName);
  }

  async restoreSession(checkpoint: Buffer): Promise<RuntimeSession> {
    const checkpointName = checkpoint.toString();
    const config = { image: checkpointName };
    return await this.createSession(config);
  }
}
