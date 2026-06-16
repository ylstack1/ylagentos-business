
import { IProvider } from './provider';

export interface RuntimeConfig {
  [key: string]: any;
}

export interface RuntimeSession {
  id: string;
  status: 'running' | 'stopped' | 'error';
  metadata?: Record<string, any>;
}

export interface IRuntimeProvider extends IProvider {
  createSession(config: RuntimeConfig): Promise<RuntimeSession>;
  exec(sessionId: string, command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  stopSession(sessionId: string): Promise<void>;
  checkpointSession(sessionId: string): Promise<Buffer>;
  restoreSession(checkpoint: Buffer): Promise<RuntimeSession>;
}
