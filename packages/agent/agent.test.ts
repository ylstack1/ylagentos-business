// ─── YL Agents OS — Agent System Tests ──────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { AgentRuntime, LocalRuntimeProvider, AgentLoader, SkillsRegistry, MCPServerManager } from "./src/index.ts";
import type { SessionConfig } from "../types/src/index.ts";

describe("AgentRuntime", () => {
  const runtime = new AgentRuntime();
  const localProvider = new LocalRuntimeProvider();
  let sessionId: string;

  beforeAll(() => {
    runtime.registerProvider(localProvider);
  });

  it("should start a session", async () => {
    const session: SessionConfig = {
      id: crypto.randomUUID(),
      workspaceId: "test",
      name: "test-agent",
      status: "created",
      runtimeProviderId: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoints: [],
    };
    sessionId = session.id;

    const result = await runtime.execute(session, "start");
    expect(result.success).toBe(true);
    expect(result.data?.runtimeSessionId).toBe(session.id);
  });

  it("should send a message", async () => {
    const session: SessionConfig = {
      id: sessionId,
      workspaceId: "test",
      name: "test-agent",
      status: "running",
      runtimeProviderId: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoints: [],
    };
    const result = await runtime.execute(session, "sendMessage", "Hello agent!");
    expect(result.success).toBe(true);
    expect(result.data).toContain("Hello agent!");
  });

  it("should create a checkpoint", async () => {
    const session: SessionConfig = {
      id: sessionId,
      workspaceId: "test",
      name: "test-agent",
      status: "running",
      runtimeProviderId: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoints: [],
    };
    const result = await runtime.execute(session, "checkpoint", "test-checkpoint");
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.label).toBe("test-checkpoint");
  });

  it("should list tools", async () => {
    const result = await localProvider.listTools(sessionId);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBeGreaterThan(0);
    expect(result.data![0]?.name).toBe("read_file");
  });

  it("should list skills", async () => {
    const result = await localProvider.listSkills(sessionId);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBe(2);
  });

  it("should stop a session", async () => {
    const session: SessionConfig = {
      id: sessionId,
      workspaceId: "test",
      name: "test-agent",
      status: "running",
      runtimeProviderId: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoints: [],
    };
    const result = await runtime.execute(session, "stop");
    expect(result.success).toBe(true);
  });
});

describe("AgentLoader", () => {
  const loader = new AgentLoader();
  const testAgentPath = "/home/agent-cli-agent-engineer/ylagentos-business/test-agent.ylagent";

  it("should load a created agent package", async () => {
    const pkg = await loader.load({ path: testAgentPath, resolveSkills: true });
    expect(pkg.identity.name).toBe("test-agent");
    expect(pkg.identity.version).toBe("0.1.0");
    expect(pkg.soul.persona).toBeDefined();
    expect(pkg.config).toBeDefined();
    expect(pkg.config.maxTokens).toBe(4096);
  });

  it("should have identity.md with YAML frontmatter", async () => {
    const content = await Bun.file(`${testAgentPath}/identity.md`).text();
    expect(content).toContain("---");
    expect(content).toContain("name: test-agent");
  });
});

describe("SkillsRegistry", () => {
  const registry = new SkillsRegistry();

  it("should register and retrieve skills", () => {
    registry.register({
      metadata: {
        name: "file-ops",
        version: "1.0.0",
        description: "Basic file operations",
        tags: ["file", "io"],
      },
      path: "/skills/file-ops",
      body: "# File Operations\nRead and write files.",
    });

    const skill = registry.get("file-ops");
    expect(skill).toBeDefined();
    expect(skill!.metadata.name).toBe("file-ops");
    expect(skill!.metadata.tags).toContain("file");
  });

  it("should search skills by name", () => {
    const results = registry.search("file");
    expect(results.length).toBe(1);
    expect(results[0]!.metadata.name).toBe("file-ops");
  });

  it("should search skills by tag", () => {
    const results = registry.search("io");
    expect(results.length).toBe(1);
  });

  it("should list all registered skills", () => {
    const all = registry.list();
    expect(all.length).toBe(1);
  });
});

describe("MCPServerManager", () => {
  const manager = new MCPServerManager();

  it("should register MCP servers", () => {
    manager.register({
      name: "test-server",
      type: "local",
      endpoint: "echo",
      enabled: true,
    });

    const servers = manager.listServers();
    expect(servers.length).toBe(1);
    expect(servers[0]!.name).toBe("test-server");
  });

  it("should list tools from registered servers", async () => {
    const tools = await manager.listTools("test-server");
    expect(tools.size).toBe(1);
    expect(tools.get("test-server")).toBeDefined();
    expect(tools.get("test-server")![0]?.name).toBe("test-server-execute");
  });
});