// ─── YL CLI — Export/Import Commands ────────────────────────────────────────
// yl export <workspace-id> [-o output.ylworkspace]
// yl import <path.ylworkspace>

import type { WorkspacePackage } from "../../../types/src/index.ts";
import { randomUUIDv7 } from "bun";

// Import the in-memory workspace store
import { workspaces } from "./workspace.ts";

const exported = new Map<string, WorkspacePackage>();

export async function exportWorkspace(workspaceId?: string, _outputPath?: string): Promise<void> {
  if (!workspaceId) {
    console.error("Usage: yl export <workspace-id>");
    process.exit(1);
  }

  const ws = workspaces.get(workspaceId);
  if (!ws) {
    console.error(`❌ Workspace not found: ${workspaceId}`);
    process.exit(1);
  }

  const wsPackage: WorkspacePackage = {
    metadata: ws,
    sessions: [],
    tasks: [],
    agents: [],
  };

  const path = _outputPath ?? `./${ws.name}.ylworkspace`;
  const json = JSON.stringify(wsPackage, null, 2);
  await Bun.write(path, json);

  exported.set(workspaceId, wsPackage);
  console.log(`📦 Exported workspace "${ws.name}" to ${path}`);
  console.log(`   Size: ${new Blob([json]).size.toLocaleString()} bytes`);
}

export async function importWorkspace(path?: string): Promise<void> {
  if (!path) {
    console.error("Usage: yl import <path.ylworkspace>");
    process.exit(1);
  }

  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`❌ File not found: ${path}`);
      process.exit(1);
    }

    const content = await file.text();
    const wsPackage = JSON.parse(content) as WorkspacePackage;

    if (!wsPackage.metadata?.id || !wsPackage.metadata?.name) {
      console.error(`❌ Invalid workspace package format`);
      process.exit(1);
    }

    const originalId = wsPackage.metadata.id;
    wsPackage.metadata.id = randomUUIDv7();

    for (const session of wsPackage.sessions) session.workspaceId = wsPackage.metadata.id;
    for (const task of wsPackage.tasks) task.workspaceId = wsPackage.metadata.id;

    wsPackage.metadata.createdAt = new Date().toISOString();
    wsPackage.metadata.updatedAt = wsPackage.metadata.createdAt;

    workspaces.set(wsPackage.metadata.id, wsPackage.metadata);

    console.log(`📦 Imported workspace "${wsPackage.metadata.name}"`);
    console.log(`   Original ID: ${originalId}`);
    console.log(`   New ID:      ${wsPackage.metadata.id}`);
    console.log(`   Sessions:    ${wsPackage.sessions.length}`);
    console.log(`   Tasks:       ${wsPackage.tasks.length}`);

  } catch (err) {
    console.error(`❌ Import failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}