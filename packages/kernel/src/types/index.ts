/**
 * Core type definitions for the YL Agents OS Kernel.
 *
 * These types form the contract between all kernel modules. They are
 * intentionally strict — no `any` types, no nullable fields where avoidable.
 */

// ── Identifiers ────────────────────────────────────────────────────────────

/** Unique workspace identifier (UUID v4). */
export type WorkspaceId = string & { __brand: "WorkspaceId" };

/** Unique session identifier (UUID v4). */
export type SessionId = string & { __brand: "SessionId" };

/** Unique task identifier (UUID v4). */
export type TaskId = string & { __brand: "TaskId" };

/** Unique event identifier (monotonic ULID). */
export type EventId = string & { __brand: "EventId" };

/** Agent identifier (human-readable slug). */
export type AgentId = string & { __brand: "AgentId" };

/** Checkpoint identifier (UUID v4). */
export type CheckpointId = string & { __brand: "CheckpointId" };

// ── Timestamps ─────────────────────────────────────────────────────────────

/** ISO-8601 UTC timestamp string. */
export type Timestamp = string;

// ── Event Store ────────────────────────────────────────────────────────────

/** Event types in the kernel event-sourcing system. */
export type EventType =
  | "workspace:created"
  | "workspace:updated"
  | "workspace:deleted"
  | "workspace:exported"
  | "session:created"
  | "session:checkpoint"
  | "session:restored"
  | "session:closed"
  | "task:created"
  | "task:assigned"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:cancelled"
  | "task:resolved"
  | "conflict:detected"
  | "conflict:resolved";

/** A single event record in the event store. */
export interface Event {
  /** Globally unique event ID (monotonic). */
  readonly id: EventId;
  /** The workspace this event belongs to. */
  readonly workspaceId: WorkspaceId;
  /** Event type discriminator. */
  readonly type: EventType;
  /** Event payload — schema varies by type. */
  readonly data: Record<string, unknown>;
  /** Monotonic sequence number within the workspace stream. */
  readonly sequence: number;
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: Timestamp;
  /** Optional causal parent event ID (for conflict DAG). */
  readonly parentId?: EventId;
  /** Optional merge event ID (for conflict resolution). */
  readonly mergeId?: EventId;
}

/** Conflict marker — an event that signals a divergent branch. */
export interface ConflictMarker {
  /** The conflict event itself. */
  readonly event: Event;
  /** The conflicting branch's base event ID. */
  readonly conflictingBaseId: EventId;
  /** Resolution strategy applied. */
  readonly resolution: ConflictResolution;
}

export type ConflictResolution = "last-writer-wins" | "manual" | "merge" | "abort";

// ── Workspace ──────────────────────────────────────────────────────────────

/** Workspace configuration stored in .ylworkspace format. */
export interface WorkspaceConfig {
  /** Human-friendly name. */
  name: string;
  /** SemVer version. */
  version: string;
  /** Human-readable description. */
  description?: string;
  /** Key-value metadata map. */
  metadata: Record<string, string>;
  /** Agent configuration slugs. */
  agents: AgentId[];
  /** Provider configuration overrides. */
  providers?: WorkspaceProviderConfig;
  /** Created timestamp. */
  createdAt: Timestamp;
  /** Last modified timestamp. */
  updatedAt: Timestamp;
}

/** Provider configuration scoped to a workspace. */
export interface WorkspaceProviderConfig {
  /** Default runtime provider. */
  runtime?: string;
  /** Default storage provider. */
  storage?: string;
  /** Default model provider. */
  model?: string;
  /** Default git provider. */
  git?: string;
}

/** Runtime workspace state (derived from events). */
export interface WorkspaceState {
  readonly id: WorkspaceId;
  readonly config: WorkspaceConfig;
  readonly activeSessions: SessionId[];
  readonly status: WorkspaceStatus;
  readonly lastEventSequence: number;
}

export type WorkspaceStatus = "active" | "archived" | "deleted";

/** .ylworkspace package format manifest. */
export interface WorkspaceManifest {
  /** Schema version of the package format. */
  manifestVersion: 1;
  /** Workspace configuration. */
  workspace: WorkspaceConfig;
  /** List of archive entries. */
  entries: WorkspaceEntry[];
  /** Optional checksums (SHA-256). */
  checksums?: Record<string, string>;
}

export interface WorkspaceEntry {
  /** Relative path within the package. */
  path: string;
  /** MIME type hint. */
  type: "config" | "checkpoint" | "artifact" | "memory" | "knowledge" | "event-log";
  /** Size in bytes. */
  size: number;
}

// ── Session ────────────────────────────────────────────────────────────────

export type SessionStatus = "running" | "paused" | "checkpointed" | "closed" | "crashed";

/** A session represents an agent's execution context within a workspace. */
export interface Session {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly status: SessionStatus;
  readonly agentId: AgentId;
  /** Serialised agent state (memory, stack, variables). */
  readonly state: SessionState;
  /** Ordered list of checkpoint IDs. */
  readonly checkpoints: CheckpointId[];
  /** Current checkpoint (if any). */
  readonly currentCheckpoint?: CheckpointId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Serialised agent session state. */
export interface SessionState {
  /** Agent memory snapshot. */
  readonly memory: Record<string, unknown>;
  /** Agent knowledge references. */
  readonly knowledge: string[];
  /** Agent variable bindings. */
  readonly variables: Record<string, string>;
  /** Execution stack (calls, returns). */
  readonly stack: ExecutionFrame[];
}

export interface ExecutionFrame {
  readonly id: string;
  readonly type: "call" | "task" | "tool" | "skill";
  readonly input: Record<string, unknown>;
  readonly output?: unknown;
  readonly startedAt: Timestamp;
  readonly completedAt?: Timestamp;
}

/** A checkpoint captures full session state at a point in time. */
export interface Checkpoint {
  readonly id: CheckpointId;
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly state: SessionState;
  readonly eventSequence: number;
  readonly createdAt: Timestamp;
  readonly label?: string;
}

// ── Task ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";

/** A unit of work to be executed by an agent. */
export interface Task {
  readonly id: TaskId;
  readonly workspaceId: WorkspaceId;
  readonly sessionId?: SessionId;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignedAgent?: AgentId;
  readonly input: Record<string, unknown>;
  readonly output?: unknown;
  readonly error?: string;
  readonly createdAt: Timestamp;
  readonly startedAt?: Timestamp;
  readonly completedAt?: Timestamp;
  readonly parentTaskId?: TaskId;
  readonly metadata: Record<string, string>;
}

/** Supervision lifecycle for an agent execution. */
export interface SupervisionLifecycle {
  readonly taskId: TaskId;
  readonly agentId: AgentId;
  readonly status: SupervisionStatus;
  /** Maximum retries before escalation. */
  readonly maxRetries: number;
  /** Current retry attempt. */
  readonly retryCount: number;
  readonly heartbeat: Timestamp;
  readonly deadline?: Timestamp;
  readonly escalationPath?: string;
}

export type SupervisionStatus = "active" | "retrying" | "escalated" | "resolved" | "timed-out";

// ── Kernel ─────────────────────────────────────────────────────────────────

/** Top-level kernel interface. */
export interface Kernel {
  // Workspace operations
  createWorkspace(config: Omit<WorkspaceConfig, "createdAt" | "updatedAt">): Promise<WorkspaceState>;
  loadWorkspace(id: WorkspaceId): Promise<WorkspaceState>;
  exportWorkspace(id: WorkspaceId, destination: string): Promise<WorkspaceManifest>;
  importWorkspace(manifestPath: string): Promise<WorkspaceState>;
  deleteWorkspace(id: WorkspaceId): Promise<void>;

  // Session operations
  createSession(workspaceId: WorkspaceId, agentId: AgentId): Promise<Session>;
  getSession(id: SessionId): Promise<Session>;
  checkpointSession(id: SessionId, label?: string): Promise<Checkpoint>;
  restoreSession(id: SessionId, checkpointId: CheckpointId): Promise<Session>;
  closeSession(id: SessionId): Promise<void>;

  // Task operations
  createTask(workspaceId: WorkspaceId, task: Omit<Task, "id" | "status" | "createdAt">): Promise<Task>;
  assignTask(taskId: TaskId, agentId: AgentId): Promise<Task>;
  executeTask(taskId: TaskId): Promise<Task>;
  completeTask(taskId: TaskId, output: unknown): Promise<Task>;
  failTask(taskId: TaskId, error: string): Promise<Task>;
  cancelTask(taskId: TaskId): Promise<Task>;
  getTask(taskId: TaskId): Promise<Task>;
  listTasks(workspaceId: WorkspaceId, status?: TaskStatus): Promise<Task[]>;

  // Event store
  getEventStore(): EventStore;
}

/** Event-sourced persistence interface. */
export interface EventStore {
  append(event: Omit<Event, "id" | "sequence" | "timestamp">): Promise<Event>;
  replay(workspaceId: WorkspaceId, sinceSequence?: number): AsyncIterable<Event>;
  getStream(workspaceId: WorkspaceId): Promise<Event[]>;
  getLatestSequence(workspaceId: WorkspaceId): Promise<number>;
  getConflictMarkers(workspaceId: WorkspaceId): Promise<ConflictMarker[]>;
  resolveConflict(marker: ConflictMarker): Promise<void>;
}
