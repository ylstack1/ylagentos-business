# YL Agents OS — Kernel Monorepo

The provider-agnostic operating system for AI agents.

## Monorepo Structure

```
yl-kernel/
├── packages/
│   ├── types/       # Shared TypeScript type definitions
│   ├── agent/       # Agent system: runtime interface, skills, MCP, format
│   ├── cli/         # `yl` CLI tool
│   ├── providers/   # Provider interface contracts (in-progress)
│   └── kernel/      # Core kernel (in-progress)
├── package.json     # Workspace root
└── tsconfig.json    # Base TypeScript config
```

## CLI Tool (`yl`)

The `yl` command is the primary user interface for YL Agents OS.

```
yl <command> [arguments...]

Commands:
  workspace  Manage workspaces (create, list, info)
  agent      Run and manage agents (run, create, stop, send, pause, resume, status)
  task       Manage tasks (list, status, cancel)
  provider   Configure providers (list, set, unset)
  export     Export a workspace to .ylworkspace
  import     Import a workspace from .ylworkspace
```

### Quick Start

```bash
# Create an agent
yl agent create my-agent "A helpful coding assistant"

# Run the agent
yl agent run ./my-agent.ylagent

# Send a message
yl agent send <session-id> "Hello!"

# List workspaces
yl workspace create my-workspace
```

## Agent System

### Universal Agent Runtime Interface

Provider-agnostic interface for managing agent sessions:
`start/stop/pause/resume/checkpoint/restore/sendMessage/cancelTask/streamEvents/listTools/listSkills`

### Native YL Agent Format (.ylagent)

```
my-agent.ylagent/
  identity.md   # Agent identity (name, version, description)
  soul.md       # Agent soul (persona, goals, constraints, tone)
  config.json   # Runtime configuration
  skills/       # Agent-specific skill overrides
  prompts/      # Prompt templates
  rules/        # Behavioral rules
```

### Skills System

Skills are reusable capability packages discovered from SKILL.md files.

### MCP Integration

Local and remote MCP server management for tool provisioning.

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.3+

### Setup

```bash
git clone <repo-url>
cd yl-kernel
bun install
```

### Run CLI

```bash
bun run packages/cli/src/index.ts
# or
bun run yl --help
```

### Test

```bash
bun test
```