import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HarnessPromptProfile = "chat" | "work";

/** Packaged Work body; Chat never loads a system prompt. */
export function renderHarnessPrompt(profile: HarnessPromptProfile = "work"): string {
  if (profile === "chat") return "";
  if (profile !== "work") throw new Error("Unknown prompt profile; use chat or work");
  const fileName = "software-development.md";
  const sourcePath = fileURLToPath(new URL(`./prompts/${fileName}`, import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const rendered = stripAuthorComments(source).replace(/\r\n/g, "\n").trim();

  if (rendered.length === 0) {
    throw new Error(`Harness prompt '${profile}' is empty`);
  }
  if (/\{\{[^}]+\}\}/.test(rendered)) {
    throw new Error(`Harness prompt '${profile}' contains an unresolved marker`);
  }
  return rendered;
}

/** Remove source-control metadata before prompt text reaches the model. */
export function stripAuthorComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}
