// ─── YL Agents OS — Skills System ──────────────────────────────────────────
// Skills are reusable capability packages: they define what an agent can do.
// Resolution: find, load, and make skills available to agent sessions.

import type { Skill, SkillMetadata } from "../../../types/src/index.ts";
import { Glob, resolveSync, file } from "bun";

export interface SkillResolutionOptions {
  /** Directories to search for skill packages */
  searchPaths: string[];
  /** Specific skill names to resolve (empty = resolve all found) */
  names?: string[];
}

/**
 * Skills Registry — discover, load, and manage skills.
 */
export class SkillsRegistry {
  private skills = new Map<string, Skill>();

  /**
   * Register a single skill from its metadata and body.
   */
  register(skill: Skill): void {
    const name = skill.metadata.name;
    if (this.skills.has(name)) {
      throw new Error(`Skill "${name}" is already registered`);
    }
    this.skills.set(name, skill);
  }

  /**
   * Unregister a skill by name.
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Get a skill by name.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List all registered skills.
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find skills matching a tag or name substring.
   */
  search(query: string): Skill[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (s) =>
        s.metadata.name.toLowerCase().includes(q) ||
        s.metadata.tags.some((t) => t.toLowerCase().includes(q)) ||
        s.metadata.description.toLowerCase().includes(q),
    );
  }

  /**
   * Load skills from filesystem .skill.md files.
   * Expected structure:
   *   skill-name/
   *     SKILL.md         # Main content with metadata frontmatter
   *     metadata.json    # Structured metadata (optional, overrides SKILL.md frontmatter)
   *     examples/        # Example usage
   *     templates/       # Prompt templates
   */
  async loadFromPaths(paths: string[]): Promise<number> {
    let count = 0;

    for (const dir of paths) {
      const glob = new Glob("**/*");
      const dirHandle = Bun.file(dir);

      // Look for SKILL.md files in subdirectories
      const skillDirs = await this.discoverSkillDirectories(dir);
      for (const skillDir of skillDirs) {
        try {
          const skill = await this.loadSkillFromDirectory(skillDir);
          if (skill && !this.skills.has(skill.metadata.name)) {
            this.skills.set(skill.metadata.name, skill);
            count++;
          }
        } catch (err) {
          console.warn(`[skills] Failed to load skill from ${skillDir}: ${err}`);
        }
      }
    }

    return count;
  }

  private async discoverSkillDirectories(baseDir: string): Promise<string[]> {
    const dirs: string[] = [];
    const scan = new Glob("*/SKILL.md");
    for await (const match of scan.scan({ cwd: baseDir, absolute: true })) {
      dirs.push(match.replace("/SKILL.md", ""));
    }
    return dirs;
  }

  private async loadSkillFromDirectory(dir: string): Promise<Skill | null> {
    const skillMdPath = `${dir}/SKILL.md`;
    const metadataPath = `${dir}/metadata.json`;
    const examplesDir = `${dir}/examples`;

    // Check if SKILL.md exists
    const skillMdFile = Bun.file(skillMdPath);
    if (!(await skillMdFile.exists())) return null;

    const rawContent = await skillMdFile.text();

    // Parse frontmatter (YAML-like)
    const metadata = await this.parseMetadata(rawContent, metadataPath);

    // Load examples
    const examples: string[] = [];
    const examplesGlob = new Glob("*.{md,txt,example}");
    for await (const exFile of examplesGlob.scan({ cwd: examplesDir, absolute: true })) {
      const content = await Bun.file(exFile).text();
      examples.push(content.substring(0, 500)); // Truncate long examples
    }

    return {
      metadata,
      path: dir,
      body: rawContent,
      examples: examples.length > 0 ? examples : undefined,
    };
  }

  private async parseMetadata(rawContent: string, metadataPath: string): Promise<SkillMetadata> {
    // Try loading structured metadata from metadata.json first
    const metaFile = Bun.file(metadataPath);
    if (await metaFile.exists()) {
      const json = await metaFile.json();
      return {
        name: json.name ?? "unknown",
        version: json.version ?? "0.1.0",
        description: json.description ?? "",
        author: json.author,
        requires: json.requires,
        dependsOn: json.dependsOn,
        tags: json.tags ?? [],
      };
    }

    // Fallback: parse YAML frontmatter from the SKILL.md
    // Simple frontmatter parser (```yaml ... ``` or --- ... ---)
    const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1]!;
      const getVal = (key: string): string | undefined => {
        const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
        const m = fm.match(re);
        return m?.[1]?.trim();
      };
      const getArr = (key: string): string[] => {
        const re = new RegExp(`^${key}:\\s*\\[?\\s*([^\\]]+)\\]?`, "m");
        const m = fm.match(re);
        if (!m) return [];
        return m[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      };

      return {
        name: getVal("name") ?? "unknown",
        version: getVal("version") ?? "0.1.0",
        description: getVal("description") ?? "",
        author: getVal("author"),
        requires: getArr("requires"),
        dependsOn: getArr("dependsOn"),
        tags: getArr("tags"),
      };
    }

    return {
      name: "unknown",
      version: "0.1.0",
      description: "No metadata found",
      tags: [],
    };
  }
}
