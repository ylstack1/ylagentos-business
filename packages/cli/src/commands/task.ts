// ─── YL CLI — Task Commands ─────────────────────────────────────────────────
// yl task list
// yl task status <id>
// yl task cancel <id>

import type { TaskConfig } from "../../../types/src/index.ts";
import { randomUUIDv7 } from "bun";

const tasks = new Map<string, TaskConfig>();

export async function listTasks(): Promise<void> {
  if (tasks.size === 0) {
    console.log("📭 No tasks found.");
    return;
  }

  const statusIcons: Record<string, string> = {
    pending: "⏳",
    running: "🔄",
    completed: "✅",
    failed: "❌",
    cancelled: "🚫",
  };

  console.log("📋 Tasks:");
  for (const task of tasks.values()) {
    const icon = statusIcons[task.status] ?? "❓";
    console.log(`  ${icon} ${task.id.substring(0, 8)}... ${task.title}`);
    console.log(`      Status: ${task.status}`);
    if (task.assignedAgentId) console.log(`      Agent: ${task.assignedAgentId}`);
  }
}

export async function taskStatus(taskId?: string): Promise<void> {
  if (!taskId) {
    console.error("Usage: yl task status <task-id>");
    process.exit(1);
  }
  const task = tasks.get(taskId);
  if (!task) {
    console.error(`❌ Task not found: ${taskId}`);
    process.exit(1);
  }
  console.log(`📋 Task: ${task.title}`);
  console.log(`   ID:       ${task.id}`);
  console.log(`   Status:   ${task.status}`);
  console.log(`   Agent:    ${task.assignedAgentId ?? "unassigned"}`);
  console.log(`   Created:  ${task.createdAt}`);
  if (task.completedAt) console.log(`   Done:     ${task.completedAt}`);
  if (task.result) console.log(`   Result:   ${task.result.substring(0, 200)}`);
}

export async function cancelTask(taskId?: string): Promise<void> {
  if (!taskId) {
    console.error("Usage: yl task cancel <task-id>");
    process.exit(1);
  }
  const task = tasks.get(taskId);
  if (!task) {
    console.error(`❌ Task not found: ${taskId}`);
    process.exit(1);
  }
  if (task.status === "completed") {
    console.log(`⚠️  Task is already completed.`);
    return;
  }
  task.status = "cancelled";
  task.updatedAt = new Date().toISOString();
  console.log(`🚫 Cancelled task: ${task.title}`);
}