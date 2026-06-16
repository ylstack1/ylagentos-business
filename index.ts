/**
 * YL Agents OS — Kernel Entry Point
 *
 * The Hybrid Distributed Kernel for provider-agnostic AI agent workspaces.
 *
 * Usage:
 * ```ts
 * import { YlKernel } from "@yl-agentos/kernel";
 *
 * const kernel = new YlKernel();
 * const ws = await kernel.createWorkspace({
 *   name: "My Workspace",
 *   version: "0.1.0",
 *   metadata: { author: "me" },
 *   agents: [],
 * });
 * ```
 */

export { YlKernel } from "./packages/kernel/src/index.ts";
export * from "./packages/kernel/src/types/index.ts";
export { SqliteEventStore } from "./packages/kernel/src/event-store/index.ts";
export { WorkspaceModule } from "./packages/kernel/src/workspace/index.ts";
export { SessionModule } from "./packages/kernel/src/session/index.ts";
export { TaskModule } from "./packages/kernel/src/task/index.ts";