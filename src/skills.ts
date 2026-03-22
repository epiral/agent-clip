import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { seedRoot, skillPath, skillsDir } from "./paths";

export interface SkillMeta {
  name: string;
  description: string;
}

export function ensureSkillsDir(): void {
  if (existsSync(skillsDir())) {
    return;
  }

  mkdirSync(skillsDir(), { recursive: true });
  const seedSkills = seedRoot("skills");
  if (!existsSync(seedSkills)) {
    return;
  }

  for (const entry of readdirSync(seedSkills, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    copyFileSync(join(seedSkills, entry.name), join(skillsDir(), entry.name));
  }
}

export async function listSkills(): Promise<SkillMeta[]> {
  ensureSkillsDir();
  if (!existsSync(skillsDir())) {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const entry of readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const raw = readFileSync(join(skillsDir(), entry.name), "utf8");
    const parsed = parseSkillFile(raw);
    skills.push({
      name: entry.name.slice(0, -3),
      description: parsed.description,
    });
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills;
}

export function loadSkill(name: string): { description: string; body: string } {
  ensureSkillsDir();
  if (!existsSync(skillPath(name))) {
    throw new Error(`skill ${JSON.stringify(name)} not found`);
  }
  return parseSkillFile(readFileSync(skillPath(name), "utf8"));
}

export function createSkill(name: string, description: string, content: string): void {
  ensureSkillsDir();
  if (existsSync(skillPath(name))) {
    throw new Error(`skill ${JSON.stringify(name)} already exists`);
  }
  writeSkillFile(skillPath(name), description, content);
}

export function updateSkill(name: string, description?: string, content?: string): void {
  const existing = loadSkill(name);
  writeSkillFile(skillPath(name), description ?? existing.description, content ?? existing.body);
}

export function deleteSkill(name: string): void {
  if (!existsSync(skillPath(name))) {
    throw new Error(`skill ${JSON.stringify(name)} not found`);
  }
  rmSync(skillPath(name), { force: true });
}

function parseSkillFile(raw: string): { description: string; body: string } {
  if (!raw.startsWith("---\n")) {
    return { description: "", body: raw.trim() };
  }

  const end = raw.indexOf("\n---", 4);
  if (end < 0) {
    return { description: "", body: raw.trim() };
  }

  const frontMatter = raw.slice(4, end);
  const body = raw.slice(end + 4).trim();
  const parsed = parseDocument(frontMatter).toJS() as { description?: string } | null;
  return {
    description: parsed?.description ?? "",
    body,
  };
}

function writeSkillFile(path: string, description: string, content: string): void {
  mkdirSync(skillsDir(), { recursive: true });
  writeFileSync(path, `---\ndescription: ${JSON.stringify(description)}\n---\n\n${content.trim()}\n`, "utf8");
}
