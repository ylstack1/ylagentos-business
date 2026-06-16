// ─── YL Agents OS — Shared Type Definitions ────────────────────────────────
// Types shared across all packages: kernel, providers, agent, cli

// ─── Workspace ──────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  /** Unique workspace identifier */
  id: string;
  /** Human-readable workspace name */
  name: string;
  /** Workspace description */
  description?: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
  /** Active provider configuration IDs per domain */
  providers: {
    runtime?: string;
    storage?: string;
    model?: string;
    git?: string;
  };
}

export interface WorkspacePackage {
  metadata: WorkspaceConfig;
  sessions: SessionConfig[];
  tasks: TaskConfig[];
  agents: AgentConfigRef[];
}

// ─── Session ────────────────────────────────────────────────────────────────

export type SessionStatus = "created" | "running" | "paused" | "stopped" | "error";

export interface SessionConfig {
  id: string;
  workspaceId: string;
  name: string;
  status: SessionStatus;
  runtimeProviderId: string;
  /** Runtime-specific session handle */
  runtimeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  /** Checkpoint slots (snapshots of session state) */
  checkpoints: Checkpoint[];
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  label: string;
  createdAt: string;
  /** Storage provider URI for the checkpoint data */
  storageUri: string;
  /** Size in bytes */
  size: number;
}

// ─── Task ───────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskConfig {
  id: string;
  workspaceId: string;
  sessionId?: string;
  title: string;
  description?: string;
  /** The agent ID assigned to this task */
  assignedAgentId?: string;
  status: TaskStatus;
  /** LLM prompt template or message */
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

export interface AgentConfigRef {
  id: string;
  name: string;
  agentPackagePath: string;
}

export interface AgentIdentity {
  name: string;
  version: string;
  description: string;
  author?: string;
  model?: string;
  runtime?: string;
  skills: string[];
  tags: string[];
}

export interface AgentSoul {
  persona: string;
  goals: string[];
  constraints: string[];
  tone: string;
}

export interface AgentPackage {
  identity: AgentIdentity;
  soul: AgentSoul;
  /** Paths to skill files within the package */
  skills: string[];
  /** Paths to prompt template files */
  prompts: string[];
  /** Paths to rule/constraint files */
  rules: string[];
  config: AgentPackageConfig;
}

export interface AgentPackageConfig {
  maxTokens?: number;
  temperature?: number;
  tools?: string[];
  mcpServers?: string[];
}

// ─── Skill ─────────────────────────────────────────────────────────────────

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  requires?: string[];
  /** MCP server names this skill depends on */
  dependsOn?: string[];
  tags: string[];
}

export interface Skill {
  metadata: SkillMetadata;
  /** The path to the skill directory or package */
  path: string;
  /** Skill content loaded at resolution time */
  body?: string;
  examples?: string[];
}

// ─── Provider ──────────────────────────────────────────────────────────────

export type ProviderDomain = "runtime" | "storage" | "model" | "git";

export interface ProviderConfig {
  id: string;
  domain: ProviderDomain;
  name: string;
  type: string;
  /** Provider-specific configuration (API keys, endpoints, etc.) */
  config: Record<string, string>;
  isDefault: boolean;
  createdAt: string;
}

// ─── Agent Runtime Interface ───────────────────────────────────────────────

export type AgentRuntimeCommand =
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "checkpoint"
  | "restore"
  | "sendMessage"
  | "cancelTask";

export interface AgentRuntimeRequest<T = unknown> {
  command: AgentRuntimeCommand;
  sessionId: string;
  /** Command-specific payload */
  payload?: T;
}

export interface AgentRuntimeResponse<T = unknown> {
  success: boolean;
  sessionId: string;
  data?: T;
  error?: string;
}

export interface AgentRuntimeEvent {
  type: "message" | "error" | "status" | "tool_call" | "tool_result" | "checkpoint";
  sessionId: string;
  timestamp: string;
  data: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
}

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
}

// ─── MCP ────────────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  name: string;
  type: "local" | "remote";
  /** For local: command to execute. For remote: URL endpoint */
  endpoint: string;
  /** Additional environment variables or headers */
  config?: Record<string, string>;
  enabled: boolean;
}

// ─── CLI Output ─────────────────────────────────────────────────────────────

export interface CLIOutput<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Human-readable message for display */
  message?: string;
}
