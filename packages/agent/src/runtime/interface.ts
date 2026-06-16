// ─── YL Agents OS — Universal Agent Runtime Interface ──────────────────────
// Provides a provider-agnostic interface for managing agent runtimes.
// Any runtime provider (local, E2B, Daytona, Docker, SSH) implements this.

import type {
  AgentRuntimeResponse,
  AgentRuntimeEvent,
  ToolDefinition,
  SkillDefinition,
  SessionConfig,
  Checkpoint,
} from "../../../types/src/index.ts";

/**
 * Abstract interface for agent runtime adapters.
 */
export interface IAgentRuntimeProvider {
  readonly providerId: string;
  readonly providerName: string;

  /** Create and start a new session */
  start(session: SessionConfig): Promise<AgentRuntimeResponse<{ runtimeSessionId: string }>>;
  /** Gracefully stop a running session */
  stop(sessionId: string): Promise<AgentRuntimeResponse>;
  /** Pause a session (checkpoint + hibernate) */
  pause(sessionId: string): Promise<AgentRuntimeResponse<Checkpoint>>;
  /** Resume from a paused state or checkpoint */
  resume(sessionId: string, checkpointId?: string): Promise<AgentRuntimeResponse>;
  /** Snapshot current state */
  checkpoint(sessionId: string, label?: string): Promise<AgentRuntimeResponse<Checkpoint>>;
  /** Restore from checkpoint */
  restore(sessionId: string, checkpointId: string): Promise<AgentRuntimeResponse>;
  /** Send a message/prompt to the agent */
  sendMessage(sessionId: string, message: string): Promise<AgentRuntimeResponse<string>>;
  /** Cancel a running task */
  cancelTask(sessionId: string, taskId: string): Promise<AgentRuntimeResponse>;
  /** Stream real-time events */
  streamEvents(
    sessionId: string,
    onEvent: (event: AgentRuntimeEvent) => void,
  ): Promise<() => void>;
  /** List available tools */
  listTools(sessionId: string): Promise<AgentRuntimeResponse<ToolDefinition[]>>;
  /** List available skills */
  listSkills(sessionId: string): Promise<AgentRuntimeResponse<SkillDefinition[]>>;
}

/**
 * The Universal Agent Runtime — orchestrates runtime providers.
 * This is the main API the kernel and CLI interact with.
 */
export class AgentRuntime {
  private providers = new Map<string, IAgentRuntimeProvider>();
  private activeSessions = new Map<string, string>(); // sessionId → providerId

  registerProvider(provider: IAgentRuntimeProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Provider "${provider.providerId}" is already registered`);
    }
    this.providers.set(provider.providerId, provider);
  }

  getProviders(): IAgentRuntimeProvider[] {
    return Array.from(this.providers.values());
  }

  getProvider(providerId: string): IAgentRuntimeProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Runtime provider "${providerId}" is not registered`);
    }
    return provider;
  }

  async execute<T = unknown>(
    session: SessionConfig,
    command: string,
    payload?: T,
  ): Promise<AgentRuntimeResponse<T>> {
    const provider = this.getProvider(session.runtimeProviderId);

    if (command === "start") this.activeSessions.set(session.id, provider.providerId);
    if (command === "stop") this.activeSessions.delete(session.id);

    switch (command) {
      case "start": return provider.start(session) as Promise<AgentRuntimeResponse<T>>;
      case "stop": return provider.stop(session.id) as Promise<AgentRuntimeResponse<T>>;
      case "pause": return provider.pause(session.id) as Promise<AgentRuntimeResponse<T>>;
      case "resume": return provider.resume(session.id, payload as string | undefined) as Promise<AgentRuntimeResponse<T>>;
      case "checkpoint": return provider.checkpoint(session.id, payload as string | undefined) as Promise<AgentRuntimeResponse<T>>;
      case "restore": return provider.restore(session.id, payload as string) as Promise<AgentRuntimeResponse<T>>;
      case "sendMessage": return provider.sendMessage(session.id, payload as string) as Promise<AgentRuntimeResponse<T>>;
      case "cancelTask": return provider.cancelTask(session.id, payload as string) as Promise<AgentRuntimeResponse<T>>;
      default:
        return { success: false, sessionId: session.id, error: `Unknown command: ${command}` } as AgentRuntimeResponse<T>;
    }
  }

  async streamEvents(
    sessionId: string,
    onEvent: (event: AgentRuntimeEvent) => void,
  ): Promise<() => void> {
    const providerId = this.activeSessions.get(sessionId);
    if (!providerId) throw new Error(`No active session found: ${sessionId}`);
    return this.getProvider(providerId).streamEvents(sessionId, onEvent);
  }
}

// ─── Built-in: Local Runtime Provider ───────────────────────────────────────

import { randomUUIDv7 } from "bun";

export class LocalRuntimeProvider implements IAgentRuntimeProvider {
  readonly providerId = "local";
  readonly providerName = "Local Runtime";

  private sessions = new Map<string, SessionConfig>();
  private abortControllers = new Map<string, AbortController>();

  async start(session: SessionConfig): Promise<AgentRuntimeResponse<{ runtimeSessionId: string }>> {
    this.sessions.set(session.id, session);
    return { success: true, sessionId: session.id, data: { runtimeSessionId: session.id } };
  }

  async stop(sessionId: string): Promise<AgentRuntimeResponse> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) { controller.abort(); this.abortControllers.delete(sessionId); }
    this.sessions.delete(sessionId);
    return { success: true, sessionId };
  }

  async pause(sessionId: string): Promise<AgentRuntimeResponse<Checkpoint>> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, sessionId, error: "Session not found" };
    const checkpoint: Checkpoint = {
      id: randomUUIDv7(),
      sessionId,
      label: `checkpoint-${Date.now()}`,
      createdAt: new Date().toISOString(),
      storageUri: `local://checkpoints/${sessionId}/${checkpoint.id}`,
      size: 0,
    };
    return { success: true, sessionId, data: checkpoint };
  }

  async resume(sessionId: string, _checkpointId?: string): Promise<AgentRuntimeResponse> {
    return this.sessions.has(sessionId)
      ? { success: true, sessionId }
      : { success: false, sessionId, error: "No session to resume" };
  }

  async checkpoint(sessionId: string, label?: string): Promise<AgentRuntimeResponse<Checkpoint>> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, sessionId, error: "Session not found" };
    const checkpoint: Checkpoint = {
      id: randomUUIDv7(),
      sessionId,
      label: label ?? `checkpoint-${Date.now()}`,
      createdAt: new Date().toISOString(),
      storageUri: `local://checkpoints/${sessionId}`,
      size: 0,
    };
    return { success: true, sessionId, data: checkpoint };
  }

  async restore(sessionId: string, checkpointId: string): Promise<AgentRuntimeResponse> {
    return this.sessions.has(sessionId)
      ? { success: true, sessionId }
      : { success: false, sessionId, error: `Checkpoint ${checkpointId} not found` };
  }

  async sendMessage(sessionId: string, message: string): Promise<AgentRuntimeResponse<string>> {
    if (!this.sessions.has(sessionId)) return { success: false, sessionId, error: "Session not found" };
    // In real implementation, this sends the message to the local LLM/agent process
    return { success: true, sessionId, data: `[local] received: ${message.substring(0, 100)}...` };
  }

  async cancelTask(sessionId: string, taskId: string): Promise<AgentRuntimeResponse> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) controller.abort();
    return { success: true, sessionId };
  }

  async streamEvents(
    sessionId: string,
    onEvent: (event: AgentRuntimeEvent) => void,
  ): Promise<() => void> {
    const interval = setInterval(() => {
      onEvent({
        type: "status",
        sessionId,
        timestamp: new Date().toISOString(),
        data: { status: "running" },
      });
    }, 5000);
    return () => clearInterval(interval);
  }

  async listTools(_sessionId: string): Promise<AgentRuntimeResponse<ToolDefinition[]>> {
    return {
      success: true,
      sessionId: _sessionId,
      data: [
        {
          name: "read_file",
          description: "Read contents of a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "write_file",
          description: "Write contents to a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
      ],
    };
  }

  async listSkills(_sessionId: string): Promise<AgentRuntimeResponse<SkillDefinition[]>> {
    return {
      success: true,
      sessionId: _sessionId,
      data: [
        { name: "file-ops", description: "Basic file operations", version: "1.0.0" },
        { name: "shell", description: "Shell command execution", version: "1.0.0" },
      ],
    };
  }
}
