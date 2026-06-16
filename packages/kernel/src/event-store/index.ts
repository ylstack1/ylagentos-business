/**
 * Event-sourced persistence layer using SQLite (via Bun's built-in).
 *
 * Stores an append-only event log per workspace. State is derived by
 * replaying events. Supports offline-first with conflict markers for
 * divergent branches.
 *
 * The store uses a single SQLite database file (workspace .yl.db) with a
 * partitioned event stream and a conflict_markers table.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  ConflictMarker,
  ConflictResolution,
  Event,
  EventId,
  EventType,
  WorkspaceId,
} from "../types/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a monotonic ULID-like ID for events. */
function generateEventId(): EventId {
  const timestamp = Date.now().toString(36).padStart(8, "0");
  const random = Math.random().toString(36).slice(2, 10).padStart(8, "0");
  return `${timestamp}-${random}` as EventId;
}

/** Get ISO-8601 UTC timestamp string. */
function nowISO(): string {
  return new Date().toISOString();
}

// ── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  type        TEXT NOT NULL,
  data        TEXT NOT NULL,  -- JSON-encoded
  sequence    INTEGER NOT NULL,
  timestamp   TEXT NOT NULL,
  parent_id   TEXT,
  merge_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_workspace_id ON events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_sequence   ON events(workspace_id, sequence);

CREATE TABLE IF NOT EXISTS conflict_markers (
  id                 TEXT PRIMARY KEY NOT NULL,
  workspace_id       TEXT NOT NULL,
  event_id           TEXT NOT NULL,
  conflicting_base_id TEXT NOT NULL,
  resolution         TEXT NOT NULL DEFAULT 'last-writer-wins',
  resolved_at        TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_conflict_workspace ON conflict_markers(workspace_id);
`;

// ── EventStore Implementation ──────────────────────────────────────────────

export class SqliteEventStore {
  private readonly db: Database;
  private readonly workspaceId: WorkspaceId;

  /**
   * Open (or create) an event-store database for the given workspace.
   *
   * @param storageDir  Directory where .yl.db files are stored.
   * @param workspaceId The workspace this store belongs to.
   */
  constructor(storageDir: string, workspaceId: WorkspaceId) {
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }
    const dbPath = join(storageDir, `${workspaceId}.yl.db`);
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    this.workspaceId = workspaceId;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ── Append ───────────────────────────────────────────────────────────────

  /**
   * Append a new event to the stream.
   * Returns the fully populated Event record.
   */
  append(
    partial: Omit<Event, "id" | "sequence" | "timestamp">,
  ): Event {
    const sequence = this.getLatestSequence(this.workspaceId) + 1;
    const event: Event = {
      id: generateEventId(),
      workspaceId: partial.workspaceId,
      type: partial.type,
      data: partial.data,
      sequence,
      timestamp: nowISO(),
      parentId: partial.parentId,
      mergeId: partial.mergeId,
    };

    const stmt = this.db.prepare(`
      INSERT INTO events (id, workspace_id, type, data, sequence, timestamp, parent_id, merge_id)
      VALUES ($id, $workspaceId, $type, $data, $sequence, $timestamp, $parentId, $mergeId)
    `);

    stmt.run({
      $id: event.id,
      $workspaceId: event.workspaceId,
      $type: event.type,
      $data: JSON.stringify(event.data),
      $sequence: event.sequence,
      $timestamp: event.timestamp,
      $parentId: event.parentId ?? null,
      $mergeId: event.mergeId ?? null,
    });

    return event;
  }

  // ── Replay ───────────────────────────────────────────────────────────────

  /**
   * Replay events for a workspace, optionally starting from a given sequence.
   * Returns an async generator for streaming consumption.
   */
  async *replay(
    workspaceId: WorkspaceId,
    sinceSequence?: number,
  ): AsyncIterable<Event> {
    const query = sinceSequence !== undefined
      ? `SELECT * FROM events WHERE workspace_id = $workspaceId AND sequence > $sinceSeq ORDER BY sequence ASC`
      : `SELECT * FROM events WHERE workspace_id = $workspaceId ORDER BY sequence ASC`;

    const stmt = this.db.prepare(query);
    const rows = sinceSequence !== undefined
      ? stmt.all({ $workspaceId: workspaceId, $sinceSeq: sinceSequence })
      : stmt.all({ $workspaceId: workspaceId });

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  /**
   * Get the full event stream for a workspace as an array.
   */
  getStream(workspaceId: WorkspaceId): Event[] {
    const stmt = this.db.prepare(
      `SELECT * FROM events WHERE workspace_id = $workspaceId ORDER BY sequence ASC`,
    );
    const rows = stmt.all({ $workspaceId: workspaceId });
    return rows.map((r) => this.rowToEvent(r));
  }

  // ── Sequence ─────────────────────────────────────────────────────────────

  /** Get the latest event sequence number for a workspace (0 if empty). */
  getLatestSequence(workspaceId: WorkspaceId): number {
    const stmt = this.db.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM events WHERE workspace_id = $workspaceId`,
    );
    const row = stmt.get({ $workspaceId: workspaceId }) as { max_seq: number };
    return row.max_seq;
  }

  // ── Conflict Markers ─────────────────────────────────────────────────────

  /** Add a conflict marker for a divergent event. */
  addConflictMarker(
    event: Event,
    conflictingBaseId: EventId,
    resolution: ConflictResolution = "last-writer-wins",
  ): ConflictMarker {
    const marker: ConflictMarker = {
      event,
      conflictingBaseId,
      resolution,
    };

    const stmt = this.db.prepare(`
      INSERT INTO conflict_markers (id, workspace_id, event_id, conflicting_base_id, resolution)
      VALUES ($id, $workspaceId, $eventId, $conflictingBaseId, $resolution)
    `);

    stmt.run({
      $id: generateEventId(),
      $workspaceId: event.workspaceId,
      $eventId: event.id,
      $conflictingBaseId: conflictingBaseId,
      $resolution: resolution,
    });

    return marker;
  }

  /** Get all unresolved conflict markers for a workspace. */
  getConflictMarkers(workspaceId: WorkspaceId): ConflictMarker[] {
    const stmt = this.db.prepare(`
      SELECT cm.*, e.id AS ev_id, e.workspace_id AS ev_workspace_id, e.type AS ev_type,
             e.data AS ev_data, e.sequence AS ev_sequence, e.timestamp AS ev_timestamp,
             e.parent_id AS ev_parent_id, e.merge_id AS ev_merge_id
      FROM conflict_markers cm
      JOIN events e ON e.id = cm.event_id
      WHERE cm.workspace_id = $workspaceId AND cm.resolved_at IS NULL
    `);
    const rows = stmt.all({ $workspaceId: workspaceId });
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        event: {
          id: row.ev_id as EventId,
          workspaceId: row.ev_workspace_id as WorkspaceId,
          type: row.ev_type as EventType,
          data: JSON.parse(row.ev_data as string),
          sequence: row.ev_sequence as number,
          timestamp: row.ev_timestamp as string,
          parentId: row.ev_parent_id as EventId | undefined,
          mergeId: row.ev_merge_id as EventId | undefined,
        },
        conflictingBaseId: row.conflicting_base_id as EventId,
        resolution: row.resolution as ConflictResolution,
      };
    });
  }

  /** Mark a conflict marker as resolved. */
  resolveConflict(marker: ConflictMarker): void {
    const stmt = this.db.prepare(`
      UPDATE conflict_markers
      SET resolution = $resolution, resolved_at = $resolvedAt
      WHERE workspace_id = $workspaceId AND event_id = $eventId
    `);
    stmt.run({
      $resolution: marker.resolution,
      $resolvedAt: nowISO(),
      $workspaceId: marker.event.workspaceId,
      $eventId: marker.event.id,
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private rowToEvent(row: unknown): Event {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as EventId,
      workspaceId: r.workspace_id as WorkspaceId,
      type: r.type as EventType,
      data: JSON.parse(r.data as string),
      sequence: r.sequence as number,
      timestamp: r.timestamp as string,
      parentId: (r.parent_id as EventId) ?? undefined,
      mergeId: (r.merge_id as EventId) ?? undefined,
    };
  }
}

// ── Re-export the interface-compatible wrapper ─────────────────────────────

export { SqliteEventStore as EventStoreImpl };