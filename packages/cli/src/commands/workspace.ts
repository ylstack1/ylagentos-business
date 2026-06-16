// ─── YL CLI — Workspace Commands ────────────────────────────────────────────
// yl workspace create <name>
// yl workspace list
// yl workspace info <id>

import type { WorkspaceConfig } from "../../../types/src/index.ts";
import { randomUUIDv7 } from "bun";

// In-memory workspace store (will be replaced by kernel persistence later)
export const workspaces = new Map<string, WorkspaceConfig>();

export async function createWorkspace(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Usage: yl workspace create <name> [description]");
    process.exit(1);
  }
  const [name, ...descParts] = args;
  const description = descParts.join(" ") || undefined;
  const id = randomUUIDv7();
  const now = new Date().toISOString();
  const ws: WorkspaceConfig = {
    id,
    name: name!,
    description,
    createdAt: now,
    updatedAt: now,
    providers: {},
  };
  workspaces.set(id, ws);
  console.log(`✅ Created workspace "${name}" (${id})`);
}

export async function listWorkspaces(): Promise<void> {
  if (workspaces.size === 0) {
    console.log("📭 No workspaces found. Create one with `yl workspace create <name>`");
    return;
  }
  console.log("📂 Workspaces:");
  for (const ws of workspaces.values()) {
    console.log(`  ${ws.id.substring(0, 8)}...  ${ws.name}  ${ws.description ?? ""}`);
  }
}

export async function workspaceInfo(id?: string): Promise<void> {
  if (!id) {
    console.error("Usage: yl workspace info <id>");
    process.exit(1);
  }
  const ws = workspaces.get(id);
  if (!ws) {
    console.error(`❌ Workspace not found: ${id}`);
    process.exit(1);
  }
  console.log(`📋 Workspace: ${ws.name}`);
  console.log(`  ID:          ${ws.id}`);
  console.log(`  Description: ${ws.description ?? "(none)"}`);
  console.log(`  Created:     ${ws.createdAt}`);
  console.log(`  Updated:     ${ws.updatedAt}`);
  console.log(`  Providers:`);
  console.log(`    Runtime: ${ws.providers.runtime ?? "not set"}`);
  console.log(`    Storage: ${ws.providers.storage ?? "not set"}`);
  console.log(`    Model:   ${ws.providers.model ?? "not set"}`);
  console.log(`    Git:     ${ws.providers.git ?? "not set"}`);
}