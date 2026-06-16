// ─── YL Agents OS — MCP Integration ────────────────────────────────────────
// Manages local and remote MCP (Model Context Protocol) servers.
// MCP servers provide tools and resources to agents.

import type { MCPServerConfig, ToolDefinition } from "../../../types/src/index.ts";
import { spawn, type Subprocess } from "bun";

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Manages MCP server lifecycle and tool resolution.
 */
export class MCPServerManager {
  private servers = new Map<string, MCPServerConfig>();
  private processes = new Map<string, Subprocess>();
  private toolCache = new Map<string, ToolDefinition[]>();

  /**
   * Register an MCP server configuration.
   */
  register(config: MCPServerConfig): void {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP server "${config.name}" is already registered`);
    }
    this.servers.set(config.name, config);
  }

  /**
   * Unregister an MCP server and stop it if running.
   */
  async unregister(name: string): Promise<void> {
    await this.stop(name);
    this.servers.delete(name);
    this.toolCache.delete(name);
  }

  /**
   * Start an MCP server (local subprocess or remote connection).
   */
  async start(name: string): Promise<void> {
    const config = this.servers.get(name);
    if (!config) throw new Error(`MCP server "${name}" not found`);
    if (this.processes.has(name)) return; // Already running

    if (config.type === "local") {
      // Parse the endpoint as a command + args
      const parts = config.endpoint.split(/\s+/);
      const cmd = parts[0]!;
      const args = parts.slice(1);

      const proc = spawn([cmd, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...config.config },
      });

      this.processes.set(name, proc);

      // Handle stderr logging
      proc.stderr.pipeTo(
        new WritableStream({
          write(chunk) {
            console.error(`[mcp:${name}] ${new TextDecoder().decode(chunk)}`);
          },
        }),
      ).catch(() => {});
    }
    // Remote MCP servers connect via HTTP/WebSocket (handled by agent runtime)
  }

  /**
   * Stop an MCP server.
   */
  async stop(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.processes.delete(name);
    }
  }

  /**
   * Stop all running MCP servers.
   */
  async stopAll(): Promise<void> {
    for (const name of this.processes.keys()) {
      await this.stop(name);
    }
  }

  /**
   * List tools provided by a specific MCP server (or all servers).
   */
  async listTools(serverName?: string): Promise<Map<string, ToolDefinition[]>> {
    const result = new Map<string, ToolDefinition[]>();

    for (const [name, config] of this.servers) {
      if (serverName && name !== serverName) continue;

      // Check cache
      const cached = this.toolCache.get(name);
      if (cached) {
        result.set(name, cached);
        continue;
      }

      // In a real implementation, this queries the MCP server for its tool list
      // For now, return a basic tool based on the server name
      const tools: ToolDefinition[] = [
        {
          name: `${name}-execute`,
          description: `Execute a command via the ${name} MCP server`,
          inputSchema: {
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
          },
        },
      ];

      this.toolCache.set(name, tools);
      result.set(name, tools);
    }

    return result;
  }

  /**
   * Call a tool on an MCP server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const config = this.servers.get(serverName);
    if (!config) return { success: false, error: `MCP server "${serverName}" not found` };

    const proc = this.processes.get(serverName);

    if (config.type === "local" && proc) {
      // Send JSON-RPC request via stdin (MCP protocol)
      const request = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: args },
        id: crypto.randomUUID(),
      });

      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(request + "\n"));
      await writer.releaseLock();

      // Read response from stdout
      const reader = proc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();

      if (value) {
        try {
          const response = JSON.parse(new TextDecoder().decode(value));
          return { success: true, data: response.result ?? response };
        } catch {
          const text = new TextDecoder().decode(value);
          return { success: true, data: text };
        }
      }

      return { success: true, data: null };
    }

    // Remote MCP servers would make HTTP requests here
    // For now, return a mock response
    return {
      success: true,
      data: { result: `[${serverName}] Tool "${toolName}" executed with args: ${JSON.stringify(args)}` },
    };
  }

  /**
   * List all registered servers.
   */
  listServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get a specific server config.
   */
  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * Check if a server is currently running.
   */
  isRunning(name: string): boolean {
    return this.processes.has(name);
  }
}
