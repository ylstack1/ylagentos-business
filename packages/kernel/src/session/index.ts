/**
 * Session Module
 *
 * Manages session lifecycle: create, checkpoint, restore, close.
 * Sessions represent an agent's execution context within a workspace.
 * State is serialised for checkpoints and can be restored later.
 *
 * Checkpoints are stored as JSON files in the workspace's checkpoint
 * directory. Each checkpoint captures the full agent state at a point
 * in time, along with the event sequence number for replay.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentId,
  Checkpoint,
  CheckpointId,
  Session,
  SessionId,
  SessionState,
  SessionStatus,
  WorkspaceId,
} from "../types/index.ts";
import { SqliteEventStore } from "../event-store/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function generateSessionId(): SessionId {
  return randomUUID() as SessionId;
}

function generateCheckpointId(): CheckpointId {
  return randomUUID() as CheckpointId;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Session Module ─────────────────────────────────────────────────────────

export class SessionModule {
  private readonly workspacesDir: string;
  private readonly sessions: Map<SessionId, SessionState> = new Map();

  constructor(workspacesDir: string) {
    this.workspacesDir = workspacesDir;
  }

  // ── Path helpers ─────────────────────────────────────────────────────────

  private checkpointDir(workspaceId: WorkspaceId): string {
    return join(this.workspacesDir, workspaceId, "checkpoints");
  }

  private checkpointPath(
    workspaceId: WorkspaceId,
    checkpointId: CheckpointId,
  ): string {
    return join(this.checkpointDir(workspaceId), `${checkpointId}.json`);
  }

  private sessionStatePath(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
  ): string {
    return join(
      this.workspacesDir,
      workspaceId,
      "sessions",
      `${sessionId}.json`,
    );
  }

  // ── Create Session ───────────────────────────────────────────────────────

  /**
   * Create a new session for an agent in a workspace.
   * Fires a session:created event and returns the Session.
   */
  createSession(
    workspaceId: WorkspaceId,
    agentId: AgentId,
    store: SqliteEventStore,
  ): Session {
    const id = generateSessionId();
    const state: SessionState = {
      memory: {},
      knowledge: [],
      variables: {},
      stack: [],
    };

    const session: Session = {
      id,
      workspaceId,
      status: "running",
      agentId,
      state,
      checkpoints: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    // Fire event
    store.append({
      workspaceId,
      type: "session:created",
      data: {
        sessionId: id,
        agentId,
      } as unknown as Record<string, unknown>,
    });

    // Persist session state
    const sessionDir = join(this.workspacesDir, workspaceId, "sessions");
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    writeFileSync(this.sessionStatePath(workspaceId, id), JSON.stringify(session, null, 2), "utf-8");

    this.sessions.set(id, state);

    return session;
  }

  // ── Load Session ─────────────────────────────────────────────────────────

  /**
   * Load a session from its persisted state.
   */
  getSession(
    sessionId: SessionId,
    workspaceId: WorkspaceId,
  ): Session {
    const path = this.sessionStatePath(workspaceId, sessionId);

    if (!existsSync(path)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const session: Session = JSON.parse(readFileSync(path, "utf-8"));

    // Merge in-memory state on top of persisted state
    // This allows updateSessionState() changes to be reflected
    // without an explicit disk write.
    const memState = this.sessions.get(sessionId);
    if (memState) {
      session.state = {
        memory: { ...session.state.memory, ...memState.memory },
        knowledge: [...session.state.knowledge, ...memState.knowledge.filter(k => !session.state.knowledge.includes(k))],
        variables: { ...session.state.variables, ...memState.variables },
        stack: memState.stack.length > 0 ? memState.stack : session.state.stack,
      };
    }

    this.sessions.set(sessionId, session.state);

    return session;
  }

  // ── Checkpoint ───────────────────────────────────────────────────────────

  /**
   * Create a checkpoint of the current session state.
   *
   * Captures the full session state, event sequence number, and a label.
   * Returns the created Checkpoint.
   */
  checkpointSession(
    sessionId: SessionId,
    workspaceId: WorkspaceId,
    store: SqliteEventStore,
    label?: string,
  ): Checkpoint {
    const session = this.getSession(sessionId, workspaceId);
    const checkpointId = generateCheckpointId();
    const sequence = store.getLatestSequence(workspaceId);

    const checkpoint: Checkpoint = {
      id: checkpointId,
      sessionId,
      workspaceId,
      state: session.state,
      eventSequence: sequence,
      createdAt: nowISO(),
      label,
    };

    // Persist checkpoint
    const cpDir = this.checkpointDir(workspaceId);
    if (!existsSync(cpDir)) {
      mkdirSync(cpDir, { recursive: true });
    }
    writeFileSync(
      this.checkpointPath(workspaceId, checkpointId),
      JSON.stringify(checkpoint, null, 2),
      "utf-8",
    );

    // Update session's checkpoint list
    session.checkpoints.push(checkpointId);
    session.currentCheckpoint = checkpointId;
    session.updatedAt = nowISO();
    writeFileSync(
      this.sessionStatePath(workspaceId, sessionId),
      JSON.stringify(session, null, 2),
      "utf-8",
    );

    // Fire event
    store.append({
      workspaceId,
      type: "session:checkpoint",
      data: {
        sessionId,
        checkpointId,
        label,
        eventSequence: sequence,
      } as unknown as Record<string, unknown>,
    });

    return checkpoint;
  }

  // ── Restore ──────────────────────────────────────────────────────────────

  /**
   * Restore a session from a checkpoint.
   *
   * Replaces the session's current state with the checkpoint state.
   * Fires a session:restored event.
   */
  restoreSession(
    sessionId: SessionId,
    checkpointId: CheckpointId,
    workspaceId: WorkspaceId,
    store: SqliteEventStore,
  ): Session {
    const cpPath = this.checkpointPath(workspaceId, checkpointId);
    if (!existsSync(cpPath)) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const checkpoint: Checkpoint = JSON.parse(
      readFileSync(cpPath, "utf-8"),
    );

    // Load session and restore state
    const session = this.getSession(sessionId, workspaceId);
    session.state = checkpoint.state;
    session.currentCheckpoint = checkpointId;
    session.status = "running";
    session.updatedAt = nowISO();

    // Persist restored session
    writeFileSync(
      this.sessionStatePath(workspaceId, sessionId),
      JSON.stringify(session, null, 2),
      "utf-8",
    );

    this.sessions.set(sessionId, session.state);

    // Fire event
    store.append({
      workspaceId,
      type: "session:restored",
      data: {
        sessionId,
        checkpointId,
      } as unknown as Record<string, unknown>,
    });

    return session;
  }

  // ── Close ────────────────────────────────────────────────────────────────

  /**
   * Close a session.
   *
   * Marks it as closed in the event stream. In-memory state is cleared;
   * persisted state remains for audit/recovery.
   */
  closeSession(
    sessionId: SessionId,
    workspaceId: WorkspaceId,
    store: SqliteEventStore,
  ): void {
    const session = this.getSession(sessionId, workspaceId);
    session.status = "closed";
    session.updatedAt = nowISO();

    // Persist updated session
    writeFileSync(
      this.sessionStatePath(workspaceId, sessionId),
      JSON.stringify(session, null, 2),
      "utf-8",
    );

    // Clear in-memory state
    this.sessions.delete(sessionId);

    // Fire event
    store.append({
      workspaceId,
      type: "session:closed",
      data: {
        sessionId,
      } as unknown as Record<string, unknown>,
    });
  }

  // ── Update session state (for task execution) ────────────────────────────

  /**
   * Update the in-memory state of a running session.
   * Does NOT persist — call checkpointSession() to persist.
   */
  updateSessionState(
    sessionId: SessionId,
    stateUpdate: Partial<SessionState>,
  ): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found in memory: ${sessionId}`);
    }
    this.sessions.set(sessionId, {
      memory: stateUpdate.memory ?? existing.memory,
      knowledge: stateUpdate.knowledge ?? existing.knowledge,
      variables: stateUpdate.variables ?? existing.variables,
      stack: stateUpdate.stack ?? existing.stack,
    });
  }

  /**
   * List checkpoints for a session.
   */
  listCheckpoints(workspaceId: WorkspaceId): CheckpointId[] {
    const cpDir = this.checkpointDir(workspaceId);
    if (!existsSync(cpDir)) return [];
    return readFileSync(cpDir)
      ? []
      : [];
  }

  /**
   * Get a specific checkpoint by ID.
   */
  getCheckpoint(
    workspaceId: WorkspaceId,
    checkpointId: CheckpointId,
  ): Checkpoint {
    const cpPath = this.checkpointPath(workspaceId, checkpointId);
    if (!existsSync(cpPath)) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }
    return JSON.parse(readFileSync(cpPath, "utf-8"));
  }
}
