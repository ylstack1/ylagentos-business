/**
 * YL Agents OS — Core Kernel
 *
 * The Hybrid Distributed Kernel entry point. Orchestrates workspace,
 * session, task, and event-store modules into a unified interface.
 *
 * The kernel operates fully offline-first. All state is derived from
 * events. No external dependencies are required for local operation.
 */

import type {
  AgentId,
  Checkpoint,
  CheckpointId,
  Event,
  Kernel,
  Session,
  SessionId,
  Task,
  TaskId,
  TaskPriority,
  TaskStatus,
  WorkspaceConfig,
  WorkspaceId,
  WorkspaceManifest,
  WorkspaceState,
} from "./types/index.ts";
import { SqliteEventStore } from "./event-store/index.ts";
import { WorkspaceModule } from "./workspace/index.ts";
import { SessionModule } from "./session/index.ts";
import { TaskModule } from "./task/index.ts";
import { join } from "node:path";
import * as os from "node:os";

// ── Default paths ──────────────────────────────────────────────────────────

function defaultKernelDir(): string {
  return join(os.homedir(), ".yl-agentos", "kernel");
}

// ── Kernel Implementation ──────────────────────────────────────────────────

export class YlKernel implements Kernel {
  private readonly kernelDir: string;
  private readonly workspaceModule: WorkspaceModule;
  private readonly sessionModule: SessionModule;
  private readonly taskModules: Map<WorkspaceId, TaskModule> = new Map();
  private readonly stores: Map<WorkspaceId, SqliteEventStore> = new Map();

  constructor(kernelDir?: string) {
    this.kernelDir = kernelDir ?? defaultKernelDir();
    this.workspaceModule = new WorkspaceModule(
      join(this.kernelDir, "workspaces"),
    );
    this.sessionModule = new SessionModule(
      join(this.kernelDir, "workspaces"),
    );
  }

  // ── Store management ─────────────────────────────────────────────────────

  private getStore(workspaceId: WorkspaceId): SqliteEventStore {
    let store = this.stores.get(workspaceId);
    if (!store) {
      store = new SqliteEventStore(
        join(this.kernelDir, "workspaces", workspaceId),
        workspaceId,
      );
      this.stores.set(workspaceId, store);
    }
    return store;
  }

  private getTaskModule(workspaceId: WorkspaceId): TaskModule {
    let taskModule = this.taskModules.get(workspaceId);
    if (!taskModule) {
      taskModule = new TaskModule(
        this.getStore(workspaceId),
        this.sessionModule,
      );
      this.taskModules.set(workspaceId, taskModule);
    }
    return taskModule;
  }

  // ── Workspace Operations ─────────────────────────────────────────────────

  async createWorkspace(
    config: Omit<WorkspaceConfig, "createdAt" | "updatedAt">,
  ): Promise<WorkspaceState> {
    return this.workspaceModule.createWorkspace(config);
  }

  async loadWorkspace(id: WorkspaceId): Promise<WorkspaceState> {
    return this.workspaceModule.loadWorkspace(id);
  }

  async exportWorkspace(
    id: WorkspaceId,
    destination: string,
  ): Promise<WorkspaceManifest> {
    return this.workspaceModule.exportWorkspace(id, destination);
  }

  async importWorkspace(manifestPath: string): Promise<WorkspaceState> {
    return this.workspaceModule.importWorkspace(manifestPath);
  }

  async deleteWorkspace(id: WorkspaceId): Promise<void> {
    this.workspaceModule.deleteWorkspace(id, false);

    // Clean up associated modules
    this.taskModules.delete(id);
    const store = this.stores.get(id);
    if (store) {
      store.close();
      this.stores.delete(id);
    }
  }

  // ── Session Operations ───────────────────────────────────────────────────

  async createSession(
    workspaceId: WorkspaceId,
    agentId: AgentId,
  ): Promise<Session> {
    const store = this.getStore(workspaceId);
    return this.sessionModule.createSession(workspaceId, agentId, store);
  }

  async getSession(id: SessionId): Promise<Session> {
    // We need the workspace ID — attempt all workspaces
    // In practice, sessions should be looked up via workspace context
    for (const wsId of this.workspaceModule.listWorkspaceIds()) {
      try {
        return this.sessionModule.getSession(id, wsId);
      } catch {
        continue;
      }
    }
    throw new Error(`Session not found: ${id}`);
  }

  async checkpointSession(
    id: SessionId,
    label?: string,
  ): Promise<Checkpoint> {
    // Find which workspace this session belongs to
    for (const wsId of this.workspaceModule.listWorkspaceIds()) {
      try {
        const session = this.sessionModule.getSession(id, wsId);
        const store = this.getStore(wsId);
        return this.sessionModule.checkpointSession(id, wsId, store, label);
      } catch {
        continue;
      }
    }
    throw new Error(`Session not found: ${id}`);
  }

  async restoreSession(
    id: SessionId,
    checkpointId: CheckpointId,
  ): Promise<Session> {
    for (const wsId of this.workspaceModule.listWorkspaceIds()) {
      try {
        const session = this.sessionModule.getSession(id, wsId);
        const store = this.getStore(wsId);
        return this.sessionModule.restoreSession(id, checkpointId, wsId, store);
      } catch {
        continue;
      }
    }
    throw new Error(`Session not found: ${id}`);
  }

  async closeSession(id: SessionId): Promise<void> {
    for (const wsId of this.workspaceModule.listWorkspaceIds()) {
      try {
        const session = this.sessionModule.getSession(id, wsId);
        const store = this.getStore(wsId);
        this.sessionModule.closeSession(id, wsId, store);
        return;
      } catch {
        continue;
      }
    }
    throw new Error(`Session not found: ${id}`);
  }

  // ── Task Operations ──────────────────────────────────────────────────────

  async createTask(
    workspaceId: WorkspaceId,
    partial: {
      title: string;
      description: string;
      priority?: TaskPriority;
      input?: Record<string, unknown>;
      sessionId?: SessionId;
      parentTaskId?: TaskId;
      metadata?: Record<string, string>;
    },
  ): Promise<Task> {
    return this.getTaskModule(workspaceId).createTask(workspaceId, partial);
  }

  async assignTask(taskId: TaskId, agentId: AgentId): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).assignTask(taskId, agentId);
  }

  async executeTask(taskId: TaskId): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).executeTask(taskId);
  }

  async completeTask(taskId: TaskId, output: unknown): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).completeTask(taskId, output);
  }

  async failTask(taskId: TaskId, error: string): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).failTask(taskId, error);
  }

  async cancelTask(taskId: TaskId): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).cancelTask(taskId);
  }

  async getTask(taskId: TaskId): Promise<Task> {
    return this.getTaskModule(
      this.findTaskWorkspace(taskId),
    ).getTask(taskId);
  }

  async listTasks(
    workspaceId: WorkspaceId,
    status?: TaskStatus,
  ): Promise<Task[]> {
    return this.getTaskModule(workspaceId).listTasks(workspaceId, status);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Find which workspace a task belongs to by scanning all task modules.
   */
  private findTaskWorkspace(taskId: TaskId): WorkspaceId {
    for (const [wsId, module] of this.taskModules) {
      try {
        module.getTask(taskId);
        return wsId;
      } catch {
        continue;
      }
    }
    throw new Error(`Task not found: ${taskId}`);
  }

  // ── Event Store Access ───────────────────────────────────────────────────

  getEventStore(): SqliteEventStore {
    throw new Error(
      "getEventStore() requires a workspace ID. Use getWorkspaceEventStore(workspaceId) instead.",
    );
  }

  /**
   * Get the event store for a specific workspace.
   */
  getWorkspaceEventStore(workspaceId: WorkspaceId): SqliteEventStore {
    return this.getStore(workspaceId);
  }

  // ── Module accessors (for direct use) ────────────────────────────────────

  getWorkspaceModule(): WorkspaceModule {
    return this.workspaceModule;
  }

  getSessionModule(): SessionModule {
    return this.sessionModule;
  }

  getTaskModuleForWorkspace(workspaceId: WorkspaceId): TaskModule {
    return this.getTaskModule(workspaceId);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Shut down the kernel and release all resources. */
  shutdown(): void {
    this.workspaceModule.shutdown();
    for (const [, store] of this.stores) {
      store.close();
    }
    this.stores.clear();
    this.taskModules.clear();
  }
}

// ── Re-export all types for convenience ────────────────────────────────────

export type {
  AgentId,
  Checkpoint,
  CheckpointId,
  ConflictMarker,
  ConflictResolution,
  Event,
  EventId,
  EventType,
  ExecutionFrame,
  Kernel,
  Session,
  SessionId,
  SessionState,
  SessionStatus,
  SupervisionLifecycle,
  SupervisionStatus,
  Task,
  TaskId,
  TaskPriority,
  TaskStatus,
  WorkspaceConfig,
  WorkspaceEntry,
  WorkspaceId,
  WorkspaceManifest,
  WorkspaceProviderConfig,
  WorkspaceState,
  WorkspaceStatus,
} from "./types/index.ts";

export { SqliteEventStore } from "./event-store/index.ts";
export { WorkspaceModule } from "./workspace/index.ts";
export { SessionModule } from "./session/index.ts";
export { TaskModule } from "./task/index.ts";