/**
 * Tests for the YL Agents OS Core Kernel.
 *
 * Covers all four modules: EventStore, Workspace, Session, and Task.
 * Uses temporary directories to avoid polluting the real workspace store.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { SqliteEventStore } from "./src/event-store/index.ts";
import { WorkspaceModule } from "./src/workspace/index.ts";
import { SessionModule } from "./src/session/index.ts";
import { TaskModule } from "./src/task/index.ts";
import { YlKernel } from "./src/index.ts";
import type {
  AgentId,
  EventId,
  WorkspaceId,
  SessionId,
  TaskId,
} from "./src/types/index.ts";

// ── Test Setup ─────────────────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), "yl-kernel-test-" + randomUUID());
const WORKSPACES_DIR = join(TEST_ROOT, "workspaces");

beforeAll(() => {
  mkdirSync(WORKSPACES_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  try {
    const { rmSync } = require("node:fs");
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function testWorkspaceId(): WorkspaceId {
  return randomUUID() as WorkspaceId;
}

function testStore(wsId: WorkspaceId): SqliteEventStore {
  return new SqliteEventStore(join(WORKSPACES_DIR, wsId), wsId);
}

// ── Event Store Tests ──────────────────────────────────────────────────────

describe("SqliteEventStore", () => {
  test("append and replay a single event", () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);

    const event = store.append({
      workspaceId: wsId,
      type: "workspace:created",
      data: { name: "test-workspace" },
    });

    expect(event.id).toBeDefined();
    expect(event.sequence).toBe(1);
    expect(event.type).toBe("workspace:created");
    expect(event.workspaceId).toBe(wsId);

    const events = store.getStream(wsId);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("workspace:created");

    store.close();
  });

  test("append multiple events with increasing sequence", () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);

    const e1 = store.append({
      workspaceId: wsId,
      type: "workspace:created",
      data: {},
    });
    const e2 = store.append({
      workspaceId: wsId,
      type: "session:created",
      data: { sessionId: "s1" },
    });
    const e3 = store.append({
      workspaceId: wsId,
      type: "task:created",
      data: { taskId: "t1" },
    });

    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e3.sequence).toBe(3);

    const events = store.getStream(wsId);
    expect(events).toHaveLength(3);

    store.close();
  });

  test("replay from sequence number", async () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);

    store.append({ workspaceId: wsId, type: "workspace:created", data: {} });
    store.append({ workspaceId: wsId, type: "session:created", data: { sessionId: "s1" } });
    store.append({ workspaceId: wsId, type: "task:created", data: { taskId: "t1" } });

    const replayed: unknown[] = [];
    for await (const event of store.replay(wsId, 1)) {
      replayed.push(event);
    }
    expect(replayed).toHaveLength(2); // sequences 2 and 3

    store.close();
  });

  test("getLatestSequence returns 0 for empty store", () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);
    expect(store.getLatestSequence(wsId)).toBe(0);
    store.close();
  });

  test("getLatestSequence after appending", () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);

    store.append({ workspaceId: wsId, type: "workspace:created", data: {} });
    expect(store.getLatestSequence(wsId)).toBe(1);

    store.append({ workspaceId: wsId, type: "session:created", data: {} });
    expect(store.getLatestSequence(wsId)).toBe(2);

    store.close();
  });

  test("conflict markers", () => {
    const wsId = testWorkspaceId();
    const store = testStore(wsId);

    const event = store.append({
      workspaceId: wsId,
      type: "workspace:created",
      data: {},
    });

    const marker = store.addConflictMarker(
      event,
      event.id,
      "last-writer-wins",
    );

    expect(marker.event.id).toBe(event.id);
    expect(marker.conflictingBaseId).toBe(event.id);

    const markers = store.getConflictMarkers(wsId);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.event.id).toBe(event.id);

    // Resolve
    store.resolveConflict(markers[0]!);
    const afterResolve = store.getConflictMarkers(wsId);
    expect(afterResolve).toHaveLength(0);

    store.close();
  });

  test("events are isolated per workspace", () => {
    const wsId1 = testWorkspaceId();
    const wsId2 = testWorkspaceId();
    const store1 = testStore(wsId1);
    const store2 = testStore(wsId2);

    store1.append({ workspaceId: wsId1, type: "workspace:created", data: {} });
    store2.append({ workspaceId: wsId2, type: "workspace:created", data: {} });

    expect(store1.getStream(wsId2)).toHaveLength(0);
    expect(store2.getStream(wsId1)).toHaveLength(0);

    store1.close();
    store2.close();
  });
});

// ── Workspace Module Tests ─────────────────────────────────────────────────

describe("WorkspaceModule", () => {
  const wsDir = join(TEST_ROOT, "ws-module-test");
  let module: WorkspaceModule;

  beforeAll(() => {
    module = new WorkspaceModule(wsDir);
  });

  afterAll(() => {
    module.shutdown();
  });

  test("create workspace returns valid state", () => {
    const state = module.createWorkspace({
      name: "Test Workspace",
      version: "0.1.0",
      description: "A test workspace",
      metadata: { author: "test" },
      agents: [] as AgentId[],
    });

    expect(state.id).toBeDefined();
    expect(state.config.name).toBe("Test Workspace");
    expect(state.config.version).toBe("0.1.0");
    expect(state.status).toBe("active");
    expect(state.lastEventSequence).toBeGreaterThanOrEqual(1);
  });

  test("load workspace by ID", () => {
    const created = module.createWorkspace({
      name: "Load Test",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    const loaded = module.loadWorkspace(created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.config.name).toBe("Load Test");
  });

  test("load non-existent workspace throws", () => {
    expect(() => module.loadWorkspace(testWorkspaceId())).toThrow(
      "Workspace not found",
    );
  });

  test("export and import roundtrip", () => {
    const created = module.createWorkspace({
      name: "Export Test",
      version: "1.0.0",
      metadata: { key: "value" },
      agents: [] as AgentId[],
    });

    // Re-open store so we have events
    const store = new SqliteEventStore(
      join(wsDir, created.id),
      created.id,
    );
    store.append({
      workspaceId: created.id,
      type: "session:created",
      data: { sessionId: randomUUID() },
    });
    store.close();

    const exportDir = join(TEST_ROOT, "exports");
    const manifest = module.exportWorkspace(created.id, exportDir);

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.workspace.name).toBe("Export Test");
    expect(manifest.entries.length).toBeGreaterThanOrEqual(1);

    // Import into a fresh module
    const importModule = new WorkspaceModule(join(TEST_ROOT, "import-test"));
    const imported = importModule.importWorkspace(
      join(exportDir, `${created.id}.ylworkspace`),
    );

    expect(imported.config.name).toBe("Export Test");
    expect(imported.config.metadata.key).toBe("value");
    expect(imported.id).not.toBe(created.id); // new ID on import

    importModule.shutdown();
  });

  test("soft delete via event", () => {
    const state = module.createWorkspace({
      name: "Delete Test",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    module.deleteWorkspace(state.id, false);
    const loaded = module.loadWorkspace(state.id);
    expect(loaded.status).toBe("deleted");
  });

  test("list workspace IDs", () => {
    const listModule = new WorkspaceModule(join(TEST_ROOT, "list-test"));
    listModule.createWorkspace({
      name: "List 1",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });
    listModule.createWorkspace({
      name: "List 2",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    const ids = listModule.listWorkspaceIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);

    listModule.shutdown();
  });
});

// ── Session Module Tests ───────────────────────────────────────────────────

describe("SessionModule", () => {
  const wsDir = join(TEST_ROOT, "session-test");
  let sessionModule: SessionModule;
  let wsModule: WorkspaceModule;
  let wsId: WorkspaceId;
  let store: SqliteEventStore;

  beforeAll(() => {
    wsModule = new WorkspaceModule(wsDir);
    const state = wsModule.createWorkspace({
      name: "Session Test",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });
    wsId = state.id;

    sessionModule = new SessionModule(wsDir);
    store = new SqliteEventStore(join(wsDir, wsId), wsId);
  });

  afterAll(() => {
    store.close();
    wsModule.shutdown();
  });

  test("create session", () => {
    const session = sessionModule.createSession(wsId, "agent-1" as AgentId, store);

    expect(session.id).toBeDefined();
    expect(session.workspaceId).toBe(wsId);
    expect(session.agentId).toBe("agent-1");
    expect(session.status).toBe("running");
    expect(session.checkpoints).toHaveLength(0);
  });

  test("get session", () => {
    const created = sessionModule.createSession(wsId, "agent-2" as AgentId, store);
    const loaded = sessionModule.getSession(created.id, wsId);

    expect(loaded.id).toBe(created.id);
    expect(loaded.agentId).toBe("agent-2");
  });

  test("checkpoint session", () => {
    const session = sessionModule.createSession(wsId, "agent-3" as AgentId, store);

    // Update some memory
    sessionModule.updateSessionState(session.id, {
      memory: { foo: "bar" },
      variables: { key: "value" },
    });

    const checkpoint = sessionModule.checkpointSession(
      session.id,
      wsId,
      store,
      "first-checkpoint",
    );

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.label).toBe("first-checkpoint");
    expect(checkpoint.state.memory).toEqual({ foo: "bar" });
    expect(checkpoint.state.variables.key).toBe("value");
    expect(checkpoint.eventSequence).toBeGreaterThanOrEqual(1);
  });

  test("restore session from checkpoint", () => {
    const session = sessionModule.createSession(wsId, "agent-4" as AgentId, store);

    sessionModule.updateSessionState(session.id, {
      memory: { saved: "data" },
      variables: { lang: "ts" },
    });

    const cp = sessionModule.checkpointSession(
      session.id,
      wsId,
      store,
      "restore-test",
    );

    // Modify state after checkpoint
    sessionModule.updateSessionState(session.id, {
      memory: { changed: "value" },
    });

    // Restore
    const restored = sessionModule.restoreSession(
      session.id,
      cp.id,
      wsId,
      store,
    );

    expect(restored.state.memory).toEqual({ saved: "data" });
    expect(restored.state.variables.lang).toBe("ts");
  });

  test("close session", () => {
    const session = sessionModule.createSession(wsId, "agent-5" as AgentId, store);
    sessionModule.closeSession(session.id, wsId, store);

    const loaded = sessionModule.getSession(session.id, wsId);
    expect(loaded.status).toBe("closed");
  });

  test("events are recorded for session lifecycle", () => {
    const wsId2 = testWorkspaceId();
    const wsDir2 = join(TEST_ROOT, "session-events");
    const wsMod2 = new WorkspaceModule(wsDir2);
    wsMod2.createWorkspace({ name: "Events", version: "1.0.0", metadata: {}, agents: [] as AgentId[] });
    wsMod2.shutdown();

    const store2 = new SqliteEventStore(join(wsDir2, wsId2), wsId2);
    const sm = new SessionModule(wsDir2);

    const session = sm.createSession(wsId2, "test-agent" as AgentId, store2);
    const cp = sm.checkpointSession(session.id, wsId2, store2, "cp1");
    sm.restoreSession(session.id, cp.id, wsId2, store2);
    sm.closeSession(session.id, wsId2, store2);

    const events = store2.getStream(wsId2);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("session:created");
    expect(eventTypes).toContain("session:checkpoint");
    expect(eventTypes).toContain("session:restored");
    expect(eventTypes).toContain("session:closed");

    store2.close();
  });
});

// ── Task Module Tests ──────────────────────────────────────────────────────

describe("TaskModule", () => {
  const wsDir = join(TEST_ROOT, "task-test");
  let wsModule: WorkspaceModule;
  let sessionModule: SessionModule;
  let store: SqliteEventStore;
  let taskModule: TaskModule;
  let wsId: WorkspaceId;
  let sessionId: SessionId;

  beforeAll(() => {
    wsModule = new WorkspaceModule(wsDir);
    const state = wsModule.createWorkspace({
      name: "Task Test",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });
    wsId = state.id;

    sessionModule = new SessionModule(wsDir);
    store = new SqliteEventStore(join(wsDir, wsId), wsId);
    taskModule = new TaskModule(store, sessionModule);

    const session = sessionModule.createSession(wsId, "task-agent" as AgentId, store);
    sessionId = session.id;
  });

  afterAll(() => {
    store.close();
    wsModule.shutdown();
  });

  test("create task", () => {
    const task = taskModule.createTask(wsId, {
      title: "Test Task",
      description: "A task for testing",
      priority: "high",
      input: { command: "run" },
      sessionId,
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe("Test Task");
    expect(task.description).toBe("A task for testing");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("pending");
  });

  test("assign task to agent", () => {
    const task = taskModule.createTask(wsId, {
      title: "Assign Task",
      description: "Assignment test",
    });

    const assigned = taskModule.assignTask(task.id, "agent-alpha" as AgentId);

    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedAgent).toBe("agent-alpha");
  });

  test("assign already-assigned task throws", () => {
    const task = taskModule.createTask(wsId, {
      title: "Double Assign",
      description: "Should fail",
    });

    taskModule.assignTask(task.id, "agent-1" as AgentId);
    expect(() => taskModule.assignTask(task.id, "agent-2" as AgentId)).toThrow(
      'status is assigned',
    );
  });

  test("execute task transitions to running", async () => {
    const task = taskModule.createTask(wsId, {
      title: "Execute Task",
      description: "Execution test",
    });

    taskModule.assignTask(task.id, "agent-beta" as AgentId);
    const running = await taskModule.executeTask(task.id);

    expect(running.status).toBe("running");
    expect(running.startedAt).toBeDefined();
  });

  test("complete task", () => {
    const task = taskModule.createTask(wsId, {
      title: "Complete Task",
      description: "Completion test",
    });

    taskModule.assignTask(task.id, "agent-gamma" as AgentId);
    taskModule.executeTask(task.id);
    const completed = taskModule.completeTask(task.id, { result: "success" });

    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({ result: "success" });
  });

  test("fail and retry task", () => {
    const task = taskModule.createTask(wsId, {
      title: "Fail Retry Task",
      description: "Retry test",
    });

    taskModule.assignTask(task.id, "agent-delta" as AgentId, 2);
    taskModule.executeTask(task.id);
    const failed = taskModule.failTask(task.id, "Something went wrong");

    // Should be re-assigned for retry
    expect(failed.status).toBe("assigned");
    expect(failed.error).toBeUndefined(); // Error cleared for retry

    const supervision = taskModule.getSupervision(task.id);
    expect(supervision.retryCount).toBe(1);
    expect(supervision.status).toBe("retrying");
  });

  test("fail beyond retry limit escalates", () => {
    const task = taskModule.createTask(wsId, {
      title: "Escalate Task",
      description: "Escalation test",
    });

    taskModule.assignTask(task.id, "agent-echo" as AgentId, 1);
    taskModule.executeTask(task.id);
    taskModule.failTask(task.id, "Attempt 1");
    // Second attempt
    taskModule.executeTask(task.id);
    const failed = taskModule.failTask(task.id, "Attempt 2");

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Attempt 2");

    const supervision = taskModule.getSupervision(task.id);
    expect(supervision.status).toBe("escalated");
    expect(supervision.retryCount).toBe(1);
  });

  test("cancel task", () => {
    const task = taskModule.createTask(wsId, {
      title: "Cancel Task",
      description: "Cancellation test",
    });

    taskModule.assignTask(task.id, "agent-foxtrot" as AgentId);
    const cancelled = taskModule.cancelTask(task.id);

    expect(cancelled.status).toBe("cancelled");
  });

  test("list tasks by workspace and status", () => {
    const wsId2 = testWorkspaceId();
    const wsDir2 = join(TEST_ROOT, "task-list-test");
    const wsMod2 = new WorkspaceModule(wsDir2);
    wsMod2.createWorkspace({ name: "Task List", version: "1.0.0", metadata: {}, agents: [] as AgentId[] });
    wsMod2.shutdown();

    const store2 = new SqliteEventStore(join(wsDir2, wsId2), wsId2);
    const sm2 = new SessionModule(wsDir2);
    const tm2 = new TaskModule(store2, sm2);

    tm2.createTask(wsId2, { title: "Task A", description: "First" });
    tm2.createTask(wsId2, { title: "Task B", description: "Second" });

    const all = tm2.listTasks(wsId2);
    expect(all).toHaveLength(2);

    const pending = tm2.listTasks(wsId2, "pending");
    expect(pending).toHaveLength(2);

    const completed = tm2.listTasks(wsId2, "completed");
    expect(completed).toHaveLength(0);

    store2.close();
  });

  test("heartbeat updates supervision", () => {
    const task = taskModule.createTask(wsId, {
      title: "Heartbeat Task",
      description: "Heartbeat test",
    });

    taskModule.assignTask(task.id, "agent-golf" as AgentId);

    const before = taskModule.getSupervision(task.id);
    const beforeHeartbeat = before.heartbeat;

    // Small delay to ensure timestamp changes
    new Promise((r) => setTimeout(r, 10)).then(() => {
      taskModule.heartbeat(task.id);
      const after = taskModule.getSupervision(task.id);
      expect(after.heartbeat).not.toBe(beforeHeartbeat);
    });
  });
});

// ── Kernel Integration Tests ───────────────────────────────────────────────

describe("YlKernel Integration", () => {
  const kernelDir = join(TEST_ROOT, "kernel-integration");
  let kernel: YlKernel;

  beforeAll(() => {
    kernel = new YlKernel(kernelDir);
  });

  afterAll(() => {
    kernel.shutdown();
  });

  test("full lifecycle: create workspace → session → task", async () => {
    // 1. Create workspace
    const ws = await kernel.createWorkspace({
      name: "Integration Test",
      version: "1.0.0",
      description: "Full integration test",
      metadata: { test: "true" },
      agents: [] as AgentId[],
    });

    expect(ws.config.name).toBe("Integration Test");

    // 2. Create session
    const session = await kernel.createSession(ws.id, "int-agent" as AgentId);
    expect(session.workspaceId).toBe(ws.id);

    // 3. Create task
    const task = await kernel.createTask(ws.id, {
      title: "Integration Task",
      description: "Integration test task",
      priority: "critical",
      sessionId: session.id,
    });
    expect(task.status).toBe("pending");

    // 4. Assign and execute
    const assigned = await kernel.assignTask(task.id, "int-agent" as AgentId);
    expect(assigned.status).toBe("assigned");

    const running = await kernel.executeTask(task.id);
    expect(running.status).toBe("running");

    // 5. Checkpoint session
    const cp = await kernel.checkpointSession(session.id, "integration-cp");
    expect(cp.sessionId).toBe(session.id);

    // 6. Complete task
    const completed = await kernel.completeTask(task.id, { done: true });
    expect(completed.status).toBe("completed");

    // 7. Close session
    await kernel.closeSession(session.id);
  });

  test("workspace export/import via kernel", async () => {
    const ws = await kernel.createWorkspace({
      name: "Kernel Export",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    // Create a session to generate events
    await kernel.createSession(ws.id, "exp-agent" as AgentId);

    const exportDir = join(TEST_ROOT, "kernel-exports");
    const manifest = await kernel.exportWorkspace(ws.id, exportDir);

    expect(manifest.workspace.name).toBe("Kernel Export");

    // Import
    const imported = await kernel.importWorkspace(
      join(exportDir, `${ws.id}.ylworkspace`),
    );
    expect(imported.config.name).toBe("Kernel Export");
    expect(imported.id).not.toBe(ws.id);
  });

  test("task error handling", async () => {
    const ws = await kernel.createWorkspace({
      name: "Error Test",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    const task = await kernel.createTask(ws.id, {
      title: "Failing Task",
      description: "Will fail",
    });

    await kernel.assignTask(task.id, "err-agent" as AgentId);
    await kernel.executeTask(task.id);

    // failTask is not directly on the Kernel interface — use TaskModule directly
    const taskModule = kernel.getTaskModuleForWorkspace(ws.id);
    const failed = taskModule.failTask(task.id, "Intentional failure");

    // Verify it was recorded in events
    const store = kernel.getWorkspaceEventStore(ws.id);
    const events = store.getStream(ws.id);
    const failEvents = events.filter((e) => e.type === "task:failed");
    expect(failEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple workspaces isolation", async () => {
    const ws1 = await kernel.createWorkspace({
      name: "Isolation 1",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    const ws2 = await kernel.createWorkspace({
      name: "Isolation 2",
      version: "1.0.0",
      metadata: {},
      agents: [] as AgentId[],
    });

    // Create same-named tasks in both workspaces
    const t1 = await kernel.createTask(ws1.id, {
      title: "Same Name",
      description: "WS1",
    });
    const t2 = await kernel.createTask(ws2.id, {
      title: "Same Name",
      description: "WS2",
    });

    const tasks1 = await kernel.listTasks(ws1.id);
    const tasks2 = await kernel.listTasks(ws2.id);

    expect(tasks1).toHaveLength(1);
    expect(tasks2).toHaveLength(1);
    expect(t1.id).not.toBe(t2.id);
  });
});