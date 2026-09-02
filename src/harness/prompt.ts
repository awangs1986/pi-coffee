import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HarnessPromptProfile = "lean" | "full";

const PROMPT_FILE_BY_PROFILE: Record<HarnessPromptProfile, string> = {
  lean: "harness-lean.md",
  full: "harness-full.md",
};

/**
 * Render one stable PI Coffee prompt increment for the original Pi Agent.
 *
 * The markdown files are the single source of prompt content. This module is
 * deliberately side-effect free: it only reads a packaged fixture, strips
 * author metadata, normalizes line endings, and rejects unresolved template
 * markers before a caller injects the result at the Pi extension seam.
 */
export function renderHarnessPrompt(profile: HarnessPromptProfile): string {
  const fileName = PROMPT_FILE_BY_PROFILE[profile];
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
