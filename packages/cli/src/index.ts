// ─── YL Agents OS — CLI Entry Point ────────────────────────────────────────
// The `yl` command — a snappy CLI for managing workspaces, agents, tasks, and providers.
// Usage: yl <command> [options]
//   yl workspace create my-workspace
//   yl workspace list
//   yl agent run my-agent
//   yl agent stop <session-id>
//   yl task list
//   yl provider config list
//   yl export my-workspace
//   yl import my-workspace.ylworkspace
//
// Uses a lightweight built-in arg parser (no external dependencies).

import * as workspaceCmd from "./commands/workspace.ts";
import * as agentCmd from "./commands/agent.ts";
import * as taskCmd from "./commands/task.ts";
import * as providerCmd from "./commands/provider.ts";
import * as exportCmd from "./commands/export-import.ts";

const VERSION = "0.1.0";

function showHelp(): void {
  console.log(`
yl — YL Agents OS CLI v${VERSION}
Usage: yl <command> [arguments...]

Commands:
  workspace  Manage workspaces
    create <name>           Create a new workspace
    list                    List all workspaces
    info <id>               Show workspace details

  agent      Run and manage agents
    run <path>              Run an agent from a .ylagent package
    create <name>           Create a new agent package skeleton
    stop <session-id>       Stop a running agent session
    send <session-id> <msg> Send a message to an agent
    pause <session-id>      Pause an agent session
    resume <session-id>     Resume a paused session
    status <session-id>     Check session status

  task       Manage tasks
    list                    List all tasks
    status <task-id>        Show task details
    cancel <task-id>        Cancel a pending/running task

  provider   Configure providers
    list                    List configured providers
    set <domain> <id>       Set a provider config
    unset <id>              Remove a provider config

  export <workspace-id>     Export a workspace to .ylworkspace
  import <path>             Import a workspace from .ylworkspace

  help, --help, -h          Show this help
  version, --version        Show version
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    console.log(`yl v${VERSION}`);
    return;
  }

  const command = args[0]!;
  const subArgs = args.slice(1);

  switch (command) {
    case "workspace": {
      if (subArgs.length === 0) return showHelp();
      switch (subArgs[0]) {
        case "create": await workspaceCmd.createWorkspace(subArgs.slice(1)); break;
        case "list":   await workspaceCmd.listWorkspaces(); break;
        case "info":   await workspaceCmd.workspaceInfo(subArgs[1]); break;
        default:       showHelp();
      }
      break;
    }

    case "agent": {
      if (subArgs.length === 0) return showHelp();
      switch (subArgs[0]) {
        case "run":    await agentCmd.runAgent(subArgs[1]); break;
        case "create": await agentCmd.createAgent(subArgs.slice(1)); break;
        case "stop":   await agentCmd.stopSession(subArgs[1]); break;
        case "send":   await agentCmd.sendMessage(subArgs[1], subArgs.slice(2).join(" ")); break;
        case "pause":  await agentCmd.pauseSession(subArgs[1]); break;
        case "resume": await agentCmd.resumeSession(subArgs[1]); break;
        case "status": await agentCmd.sessionStatus(subArgs[1]); break;
        default:       showHelp();
      }
      break;
    }

    case "task": {
      if (subArgs.length === 0) return showHelp();
      switch (subArgs[0]) {
        case "list":   await taskCmd.listTasks(); break;
        case "status": await taskCmd.taskStatus(subArgs[1]); break;
        case "cancel": await taskCmd.cancelTask(subArgs[1]); break;
        default:       showHelp();
      }
      break;
    }

    case "provider": {
      if (subArgs.length === 0) return showHelp();
      switch (subArgs[0]) {
        case "list":   await providerCmd.listProviders(); break;
        case "set":    await providerCmd.setProvider(subArgs.slice(1)); break;
        case "unset":  await providerCmd.unsetProvider(subArgs[1]); break;
        default:       showHelp();
      }
      break;
    }

    case "export": {
      await exportCmd.exportWorkspace(subArgs[0]); break;
    }

    case "import": {
      await exportCmd.importWorkspace(subArgs[0]); break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

await main();