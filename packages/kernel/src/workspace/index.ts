/**
 * Workspace Module
 *
 * Manages workspace lifecycle: create, load, export, import. Defines the
 * .ylworkspace package format and handles workspace config serialization.
 *
 * Workspace state is derived from the event store — mutation happens via
 * event append, not direct state writes.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as fs from "node:fs";
import type {
  CheckpointId,
  WorkspaceConfig,
  WorkspaceEntry,
  WorkspaceId,
  WorkspaceManifest,
  WorkspaceState,
  WorkspaceStatus,
  AgentId,
  SessionId,
  WorkspaceProviderConfig,
} from "../types/index.ts";
import { SqliteEventStore } from "../event-store/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function generateWorkspaceId(): WorkspaceId {
  return randomUUID() as WorkspaceId;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Default workspace base directory. */
function defaultWorkspacesDir(): string {
  return join(os.homedir(), ".yl-agentos", "workspaces");
}

// ── Workspace Module ───────────────────────────────────────────────────────

export class WorkspaceModule {
  private readonly workspacesDir: string;
  private readonly stores: Map<WorkspaceId, SqliteEventStore> = new Map();

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? defaultWorkspacesDir();
    if (!existsSync(this.workspacesDir)) {
      mkdirSync(this.workspacesDir, { recursive: true });
    }
  }

  // ── Internal store management ────────────────────────────────────────────

  private getStore(workspaceId: WorkspaceId): SqliteEventStore {
    let store = this.stores.get(workspaceId);
    if (!store) {
      store = new SqliteEventStore(
        join(this.workspacesDir, workspaceId),
        workspaceId,
      );
      this.stores.set(workspaceId, store);
    }
    return store;
  }

  private closeStore(workspaceId: WorkspaceId): void {
    const store = this.stores.get(workspaceId);
    if (store) {
      store.close();
      this.stores.delete(workspaceId);
    }
  }

  // ── Config file path ─────────────────────────────────────────────────────

  private configPath(workspaceId: WorkspaceId): string {
    return join(this.workspacesDir, workspaceId, "workspace.json");
  }

  private workspaceDir(workspaceId: WorkspaceId): string {
    return join(this.workspacesDir, workspaceId);
  }

  // ── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new workspace.
   *
   * Fires a workspace:created event and returns the initial WorkspaceState.
   */
  createWorkspace(
    partial: Omit<WorkspaceConfig, "createdAt" | "updatedAt">,
  ): WorkspaceState {
    const id = generateWorkspaceId();
    const dir = this.workspaceDir(id);
    mkdirSync(dir, { recursive: true });

    const config: WorkspaceConfig = {
      ...partial,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    // Write workspace config to disk
    writeFileSync(this.configPath(id), JSON.stringify(config, null, 2), "utf-8");

    // Append creation event
    const store = this.getStore(id);
    store.append({
      workspaceId: id,
      type: "workspace:created",
      data: { config } as unknown as Record<string, unknown>,
    });

    return this.getState(id);
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  /**
   * Load an existing workspace by ID.
   * Throws if the workspace directory doesn't exist.
   */
  loadWorkspace(id: WorkspaceId): WorkspaceState {
    const dir = this.workspaceDir(id);
    if (!existsSync(dir)) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return this.getState(id);
  }

  // ── Get State (derived from events) ──────────────────────────────────────

  /**
   * Derive current workspace state by replaying events.
   */
  getState(id: WorkspaceId): WorkspaceState {
    const configPath = this.configPath(id);
    if (!existsSync(configPath)) {
      throw new Error(`Workspace config not found: ${id}`);
    }

    const config: WorkspaceConfig = JSON.parse(
      readFileSync(configPath, "utf-8"),
    );

    const store = this.getStore(id);

    // Derive active sessions and status from events
    const events = store.getStream(id);
    let status: WorkspaceStatus = "active";
    const activeSessions: SessionId[] = [];

    for (const event of events) {
      if (event.type === "workspace:deleted") {
        status = "deleted";
      }
      if (event.type === "session:created") {
        const sessionId = event.data.sessionId as SessionId;
        if (!activeSessions.includes(sessionId)) {
          activeSessions.push(sessionId);
        }
      }
      if (event.type === "session:closed") {
        const sessionId = event.data.sessionId as SessionId;
        const idx = activeSessions.indexOf(sessionId);
        if (idx !== -1) {
          activeSessions.splice(idx, 1);
        }
      }
    }

    return {
      id,
      config,
      activeSessions,
      status,
      lastEventSequence: store.getLatestSequence(id),
    };
  }

  // ── Export (.ylworkspace package) ────────────────────────────────────────

  /**
   * Export a workspace to the .ylworkspace package format.
   *
   * The package is a JSON manifest + all workspace data in a structured
   * directory. In a full implementation this would be a zip/tar archive.
   */
  exportWorkspace(
    id: WorkspaceId,
    destination: string,
  ): WorkspaceManifest {
    const state = this.getState(id);
    const store = this.getStore(id);
    const events = store.getStream(id);
    const workspaceDir = this.workspaceDir(id);

    const entries: WorkspaceEntry[] = [];

    // Collect config entry
    const configRaw = readFileSync(this.configPath(id));
    entries.push({
      path: "workspace.json",
      type: "config",
      size: configRaw.length,
    });

    // Collect event log
    const eventLog = JSON.stringify(events, null, 2);
    entries.push({
      path: "events.jsonl",
      type: "event-log",
      size: Buffer.byteLength(eventLog, "utf-8"),
    });

    // Collect checkpoint files
    const checkpointDir = join(workspaceDir, "checkpoints");
    if (existsSync(checkpointDir)) {
      const files = fs.readdirSync(checkpointDir);
      for (const file of files) {
        const filePath = join(checkpointDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          entries.push({
            path: `checkpoints/${file}`,
            type: "checkpoint",
            size: stat.size,
          });
        }
      }
    }

    const manifest: WorkspaceManifest = {
      manifestVersion: 1,
      workspace: state.config,
      entries,
    };

    // Write export directory
    const exportDir = join(destination, `${id}.ylworkspace`);
    mkdirSync(exportDir, { recursive: true });

    // Copy config
    fs.cpSync(this.configPath(id), join(exportDir, "workspace.json"));

    // Write event log
    writeFileSync(join(exportDir, "events.jsonl"), eventLog, "utf-8");

    // Copy checkpoints
    if (existsSync(checkpointDir)) {
      const exportCheckpoints = join(exportDir, "checkpoints");
      mkdirSync(exportCheckpoints, { recursive: true });
      fs.cpSync(checkpointDir, exportCheckpoints, { recursive: true });
    }

    // Write manifest
    writeFileSync(
      join(exportDir, "ylworkspace.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    store.append({
      workspaceId: id,
      type: "workspace:exported",
      data: { destination: exportDir } as unknown as Record<string, unknown>,
    });

    return manifest;
  }

  // ── Import ───────────────────────────────────────────────────────────────

  /**
   * Import a workspace from a .ylworkspace package directory.
   * Creates a new workspace with a fresh ID but restores config and events.
   */
  importWorkspace(manifestPath: string): WorkspaceState {
    const ylworkspaceDir = manifestPath.endsWith(".ylworkspace")
      ? manifestPath
      : manifestPath;

    const manifestFile = join(ylworkspaceDir, "ylworkspace.json");
    if (!existsSync(manifestFile)) {
      throw new Error(
        `Invalid .ylworkspace package: missing ylworkspace.json at ${ylworkspaceDir}`,
      );
    }

    const manifest: WorkspaceManifest = JSON.parse(
      readFileSync(manifestFile, "utf-8"),
    );

    if (manifest.manifestVersion !== 1) {
      throw new Error(
        `Unsupported .ylworkspace manifest version: ${manifest.manifestVersion}`,
      );
    }

    // Create a fresh workspace but keep the original config
    const newId = generateWorkspaceId();
    const newDir = this.workspaceDir(newId);
    mkdirSync(newDir, { recursive: true });

    // Copy config with updated timestamps
    const importedConfig: WorkspaceConfig = {
      ...manifest.workspace,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    writeFileSync(
      join(newDir, "workspace.json"),
      JSON.stringify(importedConfig, null, 2),
      "utf-8",
    );

    // Import event log if present
    const eventLogPath = join(ylworkspaceDir, "events.jsonl");
    if (existsSync(eventLogPath)) {
      const eventLog = readFileSync(eventLogPath, "utf-8");
      const events: import("../types/index.ts").Event[] = JSON.parse(eventLog);
      const store = this.getStore(newId);
      for (const event of events) {
        store.append({
          workspaceId: newId,
          type: event.type,
          data: event.data,
          parentId: event.parentId,
          mergeId: event.mergeId,
        });
      }
    }

    // Import checkpoints
    const sourceCheckpoints = join(ylworkspaceDir, "checkpoints");
    if (existsSync(sourceCheckpoints)) {
      const destCheckpoints = join(newDir, "checkpoints");
      mkdirSync(destCheckpoints, { recursive: true });
      fs.cpSync(sourceCheckpoints, destCheckpoints, { recursive: true });
    }

    return this.getState(newId);
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  /**
   * Mark a workspace as deleted (soft-delete via event).
   * Optionally removes workspace directory.
   */
  deleteWorkspace(id: WorkspaceId, permanent = false): void {
    const store = this.getStore(id);

    store.append({
      workspaceId: id,
      type: "workspace:deleted",
      data: { permanent } as unknown as Record<string, unknown>,
    });

    this.closeStore(id);

    if (permanent) {
      const dir = this.workspaceDir(id);
      if (existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // ── List workspace IDs ───────────────────────────────────────────────────

  /** List all workspace directories in the workspaces directory. */
  listWorkspaceIds(): WorkspaceId[] {
    if (!existsSync(this.workspacesDir)) return [];
    return fs
      .readdirSync(this.workspacesDir)
      .filter((name) => {
        const fullPath = join(this.workspacesDir, name);
        return (
          fs.statSync(fullPath).isDirectory() &&
          existsSync(join(fullPath, "workspace.json"))
        );
      })
      .map((name) => name as WorkspaceId);
  }

  /** Clean up all open store connections. */
  shutdown(): void {
    for (const [id, store] of this.stores) {
      store.close();
      this.stores.delete(id);
    }
  }
}
