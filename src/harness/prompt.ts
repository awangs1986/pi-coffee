import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Legacy names remain renderer aliases, not additional product modes. */
export type HarnessPromptProfile = "work" | "simple" | "lean" | "full";

/**
 * Render the single Work body. This does not select tools or implement Chat.
 * The existing Harness still uses its legacy mode routing; Chat's zero-system-
 * prompt contract requires a separate change at the public Pi extension seam.
 *
 * The packaged markdown is the single source of content. Strip author metadata,
 * normalize line endings, and reject unresolved markers before injection.
 */
export function renderHarnessPrompt(profile: HarnessPromptProfile = "work"): string {
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
