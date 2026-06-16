// ─── YL CLI — Agent Commands ────────────────────────────────────────────────
// yl agent run <path>
// yl agent create <name>
// yl agent stop <session-id>
// yl agent send <session-id> <message>
// yl agent pause <session-id>
// yl agent resume <session-id>
// yl agent status <session-id>

import { AgentRuntime, LocalRuntimeProvider, AgentLoader } from "../../../agent/src/index.ts";
import type { SessionConfig } from "../../../types/src/index.ts";
import { randomUUIDv7 } from "bun";

// Sessions created via CLI
const sessions = new Map<string, SessionConfig>();
const agentRuntime = new AgentRuntime();

// Register the local runtime provider by default
agentRuntime.registerProvider(new LocalRuntimeProvider());

export async function runAgent(packagePath?: string): Promise<void> {
  if (!packagePath) {
    console.error("Usage: yl agent run <path-to-.ylagent>");
    process.exit(1);
  }

  try {
    const loader = new AgentLoader();
    const agentPkg = await loader.load({ path: packagePath, resolveSkills: true });

    console.log(`🤖 Agent: ${agentPkg.identity.name} v${agentPkg.identity.version}`);
    console.log(`   ${agentPkg.identity.description}`);

    const sessionId = randomUUIDv7();
    const session: SessionConfig = {
      id: sessionId,
      workspaceId: "default",
      name: agentPkg.identity.name,
      status: "created",
      runtimeProviderId: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkpoints: [],
    };

    sessions.set(sessionId, session);

    const result = await agentRuntime.execute(session, "start");
    if (!result.success) {
      console.error(`❌ Failed to start agent: ${result.error}`);
      process.exit(1);
    }

    session.status = "running";
    console.log(`✅ Agent running — Session: ${sessionId}`);
    console.log(`   Model: ${agentPkg.identity.model ?? "default"}`);
    console.log(`   Runtime: ${session.runtimeProviderId}`);
    console.log(`   Skills: ${agentPkg.identity.skills.join(", ") || "(none)"}`);
    console.log(``);
    console.log(`   Send messages: yl agent send ${sessionId} "<message>"`);
    console.log(`   Stop:          yl agent stop ${sessionId}`);

  } catch (err) {
    console.error(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export async function createAgent(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Usage: yl agent create <name> [description]");
    process.exit(1);
  }
  const [name, ...descParts] = args;
  const description = descParts.join(" ") || `A YL agent named ${name}`;

  const loader = new AgentLoader();
  await loader.create(
    `./${name}.ylagent`,
    {
      name: name!,
      version: "0.1.0",
      description,
      author: "user",
      skills: [],
      tags: [],
    },
    {
      persona: `I am ${name}, a YL agent.`,
      goals: ["Help users accomplish their tasks"],
      constraints: ["I must be helpful and safe"],
      tone: "professional",
    },
  );

  console.log(`✅ Created agent package at: ./${name}.ylagent`);
  console.log(`   identity.md  — who this agent is`);
  console.log(`   soul.md      — the agent's personality and constraints`);
  console.log(`   config.json  — runtime configuration`);
  console.log(`   skills/      — agent-specific skills`);
  console.log(`   prompts/     — prompt templates`);
  console.log(`   rules/       — behavioral rules`);
}

export async function stopSession(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error("Usage: yl agent stop <session-id>");
    process.exit(1);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`❌ Session not found: ${sessionId}`);
    process.exit(1);
  }
  const result = await agentRuntime.execute(session, "stop");
  if (result.success) {
    session.status = "stopped";
    console.log(`🛑 Stopped session: ${sessionId}`);
  } else {
    console.error(`❌ Error: ${result.error}`);
  }
}

export async function sendMessage(sessionId?: string, message?: string): Promise<void> {
  if (!sessionId || !message) {
    console.error("Usage: yl agent send <session-id> <message>");
    process.exit(1);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`❌ Session not found: ${sessionId}`);
    process.exit(1);
  }
  const result = await agentRuntime.execute(session, "sendMessage", message);
  if (result.success) {
    console.log(`💬 ${result.data ?? "(no response)"}`);
  } else {
    console.error(`❌ Error: ${result.error}`);
  }
}

export async function pauseSession(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error("Usage: yl agent pause <session-id>");
    process.exit(1);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`❌ Session not found: ${sessionId}`);
    process.exit(1);
  }
  const result = await agentRuntime.execute(session, "pause");
  if (result.success) {
    session.status = "paused";
    console.log(`⏸️  Paused session: ${sessionId}`);
    if (result.data && typeof result.data === "object" && "id" in result.data) {
      console.log(`   Checkpoint: ${(result.data as { id: string }).id}`);
    }
  } else {
    console.error(`❌ Error: ${result.error}`);
  }
}

export async function resumeSession(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error("Usage: yl agent resume <session-id>");
    process.exit(1);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`❌ Session not found: ${sessionId}`);
    process.exit(1);
  }
  const result = await agentRuntime.execute(session, "resume");
  if (result.success) {
    session.status = "running";
    console.log(`▶️  Resumed session: ${sessionId}`);
  } else {
    console.error(`❌ Error: ${result.error}`);
  }
}

export async function sessionStatus(sessionId?: string): Promise<void> {
  if (!sessionId) {
    console.error("Usage: yl agent status <session-id>");
    process.exit(1);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.log(`❓ Session not found: ${sessionId}`);
    return;
  }
  const statusIcons: Record<string, string> = {
    created: "🆕",
    running: "▶️",
    paused: "⏸️",
    stopped: "🛑",
    error: "❌",
  };
  console.log(`${statusIcons[session.status] ?? "❓"} Agent session: ${sessionId}`);
  console.log(`   Status:   ${session.status}`);
  console.log(`   Name:     ${session.name}`);
  console.log(`   Runtime:  ${session.runtimeProviderId}`);
  console.log(`   Created:  ${session.createdAt}`);
  console.log(`   Checkpoints: ${session.checkpoints.length}`);
}