// ─── YL Agents OS — Native YL Agent Format (.ylagent) ──────────────────────
// The .ylagent package format: identity.md, soul.md, skills/, prompts/, rules/, config.json
//
// Directory structure:
//   my-agent.ylagent/
//     identity.md        # Agent identity (name, version, description, author)
//     soul.md            # Agent soul (persona, goals, constraints, tone)
//     skills/            # Agent-specific skills (overrides global skills)
//     prompts/           # Prompt templates
//     rules/             # Behavioral rules / constraints
//     config.json        # Structured config (model params, tool access list)

import type {
  AgentPackage,
  AgentPackageConfig,
  AgentIdentity,
  AgentSoul,
} from "../../../types/src/index.ts";
import { Glob } from "bun";

export interface AgentLoadOptions {
  /** Path to the .ylagent directory or .ylagent file */
  path: string;
  /** Whether to resolve skills from the agent package */
  resolveSkills?: boolean;
}

/**
 * YL Agent Loader — load, validate, and resolve agent packages.
 */
export class AgentLoader {
  /**
   * Load a native YL agent package from disk.
   */
  async load(options: AgentLoadOptions): Promise<AgentPackage> {
    const { path } = options;

    // Validate path by checking for identity.md
    const identityFile = Bun.file(`${path}/identity.md`);
    if (!(await identityFile.exists())) {
      throw new Error(`Agent package not found at: ${path} (missing identity.md)`);
    }

    // Load identity
    const identity = await this.loadIdentity(path);

    // Load soul
    const soul = await this.loadSoul(path);

    // Load config
    const config = await this.loadConfig(path);

    // List skills, prompts, rules
    const skills = options.resolveSkills ? await this.listFiles(path, "skills") : [];
    const prompts = await this.listFiles(path, "prompts");
    const rules = await this.listFiles(path, "rules");

    return {
      identity,
      soul,
      skills,
      prompts,
      rules,
      config,
    };
  }

  /**
   * Create a new .ylagent package skeleton.
   */
  async create(path: string, identity: AgentIdentity, soul: AgentSoul, config?: Partial<AgentPackageConfig>): Promise<AgentPackage> {
    const dir = path.endsWith(".ylagent") ? path : `${path}.ylagent`;

    // Create directories
    const subdirs = ["skills", "prompts", "rules"];
    for (const sub of subdirs) {
      await Bun.write(`${dir}/${sub}/.gitkeep`, "");
    }

    // Write identity.md
    await this.writeIdentity(dir, identity);

    // Write soul.md
    await this.writeSoul(dir, soul);

    // Write config.json
    const fullConfig: AgentPackageConfig = {
      maxTokens: config?.maxTokens ?? 4096,
      temperature: config?.temperature ?? 0.7,
      tools: config?.tools ?? [],
      mcpServers: config?.mcpServers ?? [],
    };
    await Bun.write(`${dir}/config.json`, JSON.stringify(fullConfig, null, 2));

    return {
      identity,
      soul,
      skills: [],
      prompts: [],
      rules: [],
      config: fullConfig,
    };
  }

  private async loadIdentity(dir: string): Promise<AgentIdentity> {
    const path = `${dir}/identity.md`;
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`Agent package missing identity.md at: ${dir}`);
    }
    const content = await file.text();

    // Parse YAML-like frontmatter from identity.md
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      throw new Error(`identity.md must have YAML frontmatter (--- ... ---)`);
    }

    const fm = fmMatch[1]!;
    return {
      name: this.fmGet(fm, "name") ?? "unknown",
      version: this.fmGet(fm, "version") ?? "0.1.0",
      description: this.fmGet(fm, "description") ?? "",
      author: this.fmGet(fm, "author"),
      model: this.fmGet(fm, "model"),
      runtime: this.fmGet(fm, "runtime"),
      skills: this.fmGetArr(fm, "skills"),
      tags: this.fmGetArr(fm, "tags"),
    };
  }

  private async loadSoul(dir: string): Promise<AgentSoul> {
    const path = `${dir}/soul.md`;
    const file = Bun.file(path);
    const content = file.exists() ? await file.text() : "";

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";

    // The soul body is everything after the frontmatter
    const body = fmMatch ? content.slice(fmMatch[0]!.length).trim() : content.trim();

    return {
      persona: this.fmGet(fm, "persona") ?? body,
      goals: this.fmGetArr(fm, "goals"),
      constraints: this.fmGetArr(fm, "constraints"),
      tone: this.fmGet(fm, "tone") ?? "neutral",
    };
  }

  private async loadConfig(dir: string): Promise<AgentPackageConfig> {
    const path = `${dir}/config.json`;
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return { maxTokens: 4096, temperature: 0.7, tools: [], mcpServers: [] };
    }
    return await file.json() as AgentPackageConfig;
  }

  private async listFiles(baseDir: string, subdir: string): Promise<string[]> {
    const dir = `${baseDir}/${subdir}`;
    const dirHandle = Bun.file(dir);
    if (!(await dirHandle.exists())) return [];

    const files: string[] = [];
    const glob = new Glob("*.{md,txt,json,yml,yaml}");
    for await (const file of glob.scan({ cwd: dir, absolute: false })) {
      files.push(`${subdir}/${file}`);
    }
    return files;
  }

  private async writeIdentity(dir: string, identity: AgentIdentity): Promise<void> {
    const content = `---
name: ${identity.name}
version: ${identity.version}
description: ${identity.description}
author: ${identity.author ?? ""}
model: ${identity.model ?? ""}
runtime: ${identity.runtime ?? ""}
skills: [${identity.skills.join(", ")}]
tags: [${identity.tags.join(", ")}]
---

# ${identity.name}

${identity.description}
`;
    await Bun.write(`${dir}/identity.md`, content);
  }

  private async writeSoul(dir: string, soul: AgentSoul): Promise<void> {
    const content = `---
persona: ${soul.persona}
goals: [${soul.goals.join(", ")}]
constraints: [${soul.constraints.join(", ")}]
tone: ${soul.tone}
---

${soul.persona}

## Goals
${soul.goals.map((g) => `- ${g}`).join("\n")}

## Constraints
${soul.constraints.map((c) => `- ${c}`).join("\n")}

## Tone
${soul.tone}
`;
    await Bun.write(`${dir}/soul.md`, content);
  }

  // Helper: get a string value from YAML frontmatter
  private fmGet(fm: string, key: string): string | undefined {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const m = fm.match(re);
    return m?.[1]?.trim();
  }

  // Helper: get an array value from YAML frontmatter
  private fmGetArr(fm: string, key: string): string[] {
    const re = new RegExp(`^${key}:\\s*\\[?\\s*([^\\]]+)\\]?`, "m");
    const m = fm.match(re);
    if (!m) return [];
    return m[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  }
}