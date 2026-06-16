/**
 * Task Module
 *
 * Manages task lifecycle: creation, assignment, execution, and
 * supervision. Tasks are units of work executed by agents within
 * sessions. The execution engine dispatches tasks and tracks their
 * lifecycle through the event store.
 *
 * Supervision tracks agent health via heartbeats and retries.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentId,
  SessionId,
  SupervisionLifecycle,
  SupervisionStatus,
  Task,
  TaskId,
  TaskPriority,
  TaskStatus,
  WorkspaceId,
} from "../types/index.ts";
import { SqliteEventStore } from "../event-store/index.ts";
import { SessionModule } from "../session/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function generateTaskId(): TaskId {
  return randomUUID() as TaskId;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Task Module ────────────────────────────────────────────────────────────

export class TaskModule {
  private readonly sessionModule: SessionModule;
  private readonly tasks: Map<TaskId, Task> = new Map();
  private readonly supervisions: Map<TaskId, SupervisionLifecycle> = new Map();
  private readonly store: SqliteEventStore;

  constructor(
    store: SqliteEventStore,
    sessionModule: SessionModule,
  ) {
    this.store = store;
    this.sessionModule = sessionModule;
  }

  // ── Create Task ──────────────────────────────────────────────────────────

  /**
   * Create a new task in a workspace.
   *
   * Tasks start in "pending" status and can be assigned to agents
   * for execution.
   */
  createTask(
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
  ): Task {
    const id = generateTaskId();
    const now = nowISO();

    const task: Task = {
      id,
      workspaceId,
      sessionId: partial.sessionId,
      title: partial.title,
      description: partial.description,
      priority: partial.priority ?? "normal",
      status: "pending",
      input: partial.input ?? {},
      createdAt: now,
      metadata: partial.metadata ?? {},
    };

    this.tasks.set(id, task);

    // Fire event
    this.store.append({
      workspaceId,
      type: "task:created",
      data: {
        taskId: id,
        title: task.title,
        priority: task.priority,
      } as unknown as Record<string, unknown>,
    });

    return task;
  }

  // ── Assign Task ──────────────────────────────────────────────────────────

  /**
   * Assign a task to an agent.
   *
   * Transitions the task from "pending" to "assigned".
   * Creates a supervision lifecycle entry.
   */
  assignTask(
    taskId: TaskId,
    agentId: AgentId,
    maxRetries = 3,
    deadline?: string,
  ): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "pending") {
      throw new Error(
        `Cannot assign task ${taskId}: status is ${task.status}, expected "pending"`,
      );
    }

    const updatedTask: Task = {
      ...task,
      status: "assigned",
      assignedAgent: agentId,
    };

    this.tasks.set(taskId, updatedTask);

    // Create supervision lifecycle
    const supervision: SupervisionLifecycle = {
      taskId,
      agentId,
      status: "active",
      maxRetries,
      retryCount: 0,
      heartbeat: nowISO(),
      deadline: deadline ?? undefined,
    };
    this.supervisions.set(taskId, supervision);

    // Fire event
    this.store.append({
      workspaceId: task.workspaceId,
      type: "task:assigned",
      data: {
        taskId,
        agentId,
        maxRetries,
      } as unknown as Record<string, unknown>,
    });

    return updatedTask;
  }

  // ── Execute Task ─────────────────────────────────────────────────────────

  /**
   * Execute a task by its assigned agent.
   *
   * Transitions task from "assigned" to "running", updates the
   * session state via the session module, and fires events.
   *
   * This is a framework-level execution — the actual agent logic
   * runs via the Agent Runtime Interface (owned by CLI & Agent
   * Engineer). This module sets up the execution environment.
   */
  async executeTask(taskId: TaskId): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === "cancelled") {
      throw new Error(`Cannot execute cancelled task: ${taskId}`);
    }

    const now = nowISO();
    const runningTask: Task = {
      ...task,
      status: "running",
      startedAt: now,
    };

    this.tasks.set(taskId, runningTask);

    // Fire event
    this.store.append({
      workspaceId: task.workspaceId,
      type: "task:started",
      data: {
        taskId,
        agentId: task.assignedAgent,
        startedAt: now,
      } as unknown as Record<string, unknown>,
    });

    // Update supervision heartbeat
    const supervision = this.supervisions.get(taskId);
    if (supervision) {
      this.supervisions.set(taskId, {
        ...supervision,
        heartbeat: now,
      });
    }

    return runningTask;
  }

  // ── Complete Task ────────────────────────────────────────────────────────

  /**
   * Mark a task as completed with an output value.
   */
  completeTask(taskId: TaskId, output: unknown): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = nowISO();
    const completed: Task = {
      ...task,
      status: "completed",
      output,
      completedAt: now,
    };

    this.tasks.set(taskId, completed);

    // Resolve supervision
    const supervision = this.supervisions.get(taskId);
    if (supervision) {
      this.supervisions.set(taskId, {
        ...supervision,
        status: "resolved",
      });
    }

    // Fire event
    this.store.append({
      workspaceId: task.workspaceId,
      type: "task:completed",
      data: {
        taskId,
        output: output as Record<string, unknown>,
      },
    });

    return completed;
  }

  // ── Fail Task ────────────────────────────────────────────────────────────

  /**
   * Mark a task as failed with an error message.
   * Supervision may trigger retries or escalation.
   */
  failTask(taskId: TaskId, error: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const now = nowISO();
    const failed: Task = {
      ...task,
      status: "failed",
      error,
      completedAt: now,
    };

    this.tasks.set(taskId, failed);

    // Supervision: check retries
    const supervision = this.supervisions.get(taskId);
    if (supervision && supervision.retryCount < supervision.maxRetries) {
      // Re-assign for retry
      this.supervisions.set(taskId, {
        ...supervision,
        status: "retrying",
        retryCount: supervision.retryCount + 1,
      });
      // Reset to assigned for retry
      const retryTask: Task = {
        ...failed,
        status: "assigned",
        error: undefined,
        completedAt: undefined,
      };
      this.tasks.set(taskId, retryTask);
    } else if (supervision) {
      this.supervisions.set(taskId, {
        ...supervision,
        status: "escalated",
      });
    }

    // Fire event
    this.store.append({
      workspaceId: task.workspaceId,
      type: "task:failed",
      data: {
        taskId,
        error,
        retryCount:
          this.supervisions.get(taskId)?.retryCount ?? 0,
      } as unknown as Record<string, unknown>,
    });

    return this.tasks.get(taskId) ?? failed;
  }

  // ── Cancel Task ──────────────────────────────────────────────────────────

  /**
   * Cancel a task. Works from any non-terminal status.
   */
  cancelTask(taskId: TaskId): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const terminalStatuses: TaskStatus[] = ["completed", "failed", "cancelled"];
    if (terminalStatuses.includes(task.status)) {
      throw new Error(
        `Cannot cancel task ${taskId}: already in terminal state "${task.status}"`,
      );
    }

    const now = nowISO();
    const cancelled: Task = {
      ...task,
      status: "cancelled",
      completedAt: now,
    };

    this.tasks.set(taskId, cancelled);

    // Resolve supervision
    const supervision = this.supervisions.get(taskId);
    if (supervision) {
      this.supervisions.set(taskId, {
        ...supervision,
        status: "resolved",
      });
    }

    // Fire event
    this.store.append({
      workspaceId: task.workspaceId,
      type: "task:cancelled",
      data: {
        taskId,
      } as unknown as Record<string, unknown>,
    });

    return cancelled;
  }

  // ── Read Operations ──────────────────────────────────────────────────────

  /** Get a single task by ID. */
  getTask(taskId: TaskId): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  /** List tasks for a workspace, optionally filtered by status. */
  listTasks(
    workspaceId: WorkspaceId,
    status?: TaskStatus,
  ): Task[] {
    const result: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.workspaceId === workspaceId) {
        if (status === undefined || task.status === status) {
          result.push(task);
        }
      }
    }
    return result;
  }

  /** Get pending tasks for a workspace (queue). */
  getPendingTasks(workspaceId: WorkspaceId): Task[] {
    return this.listTasks(workspaceId, "pending");
  }

  /** Get supervision lifecycle for a task. */
  getSupervision(taskId: TaskId): SupervisionLifecycle {
    const supervision = this.supervisions.get(taskId);
    if (!supervision) {
      throw new Error(`Supervision not found for task: ${taskId}`);
    }
    return supervision;
  }

  /** Update heartbeat on supervision. */
  heartbeat(taskId: TaskId): void {
    const supervision = this.supervisions.get(taskId);
    if (supervision) {
      this.supervisions.set(taskId, {
        ...supervision,
        heartbeat: nowISO(),
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Clear all in-memory tasks and supervisions. */
  clear(): void {
    this.tasks.clear();
    this.supervisions.clear();
  }
}
