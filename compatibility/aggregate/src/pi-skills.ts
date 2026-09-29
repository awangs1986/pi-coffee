import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export function resolvePiSkills(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.PI_COFFEE_SKILLS?.trim();
  if (configured === "off") return [];
  if (configured) return configured.split(delimiter).map((value) => value.trim()).filter(Boolean);
  const skill = join(moduleDirectory, "..", "skills", "lsp");
  return existsSync(skill) ? [skill] : [];
}

/** Ensure the Skill's `coffee-lsp` command resolves in Host-spawned Pi shells. */
export function withCoffeeLspPath(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const binDirectory = join(moduleDirectory, "..", "bin");
  return { PATH: [binDirectory, env.PATH ?? ""].filter(Boolean).join(delimiter) };
}
