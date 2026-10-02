import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type HarnessPromptProfile = "chat" | "work";

/** Bound only the Harness Work addition, not Pi Base, project context, or tool schemas. */
export const MAX_WORK_PROMPT_BYTES = 12711;

const OPTIONAL_GUIDANCE = [
  { tools: ["subagents_enable", "subagent"], file: "subagents.md" },
  { tools: ["recall_folded"], file: "recall-folded.md" },
  { tools: ["lsp"], file: "lsp.md" },
] as const;

/** Packaged Work body; Chat never loads a system prompt. */
export function renderHarnessPrompt(profile: HarnessPromptProfile = "work", activeTools: readonly string[] = []): string {
  if (profile === "chat") return "";
  if (profile !== "work") throw new Error("Unknown prompt profile; use chat or work");
  const active = new Set(activeTools);
  const pieces = [readPrompt("software-development.md")];
  for (const guidance of OPTIONAL_GUIDANCE) {
    if (guidance.tools.some(tool => active.has(tool))) pieces.push(readPrompt(guidance.file));
  }
  const rendered = pieces.join("\n\n");

  const bytes = Buffer.byteLength(rendered, "utf8");
  if (bytes > MAX_WORK_PROMPT_BYTES) {
    throw new Error(`Harness prompt '${profile}' exceeds ${MAX_WORK_PROMPT_BYTES} UTF-8 bytes (${bytes})`);
  }
  return rendered;
}

function readPrompt(fileName: string): string {
  const sourcePath = fileURLToPath(new URL(`./prompts/${fileName}`, import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const rendered = stripAuthorComments(source).replace(/\r\n/g, "\n").trim();
  if (rendered.length === 0) throw new Error(`Harness prompt '${fileName}' is empty`);
  if (/\{\{[^}]+\}\}/.test(rendered)) {
    throw new Error(`Harness prompt '${fileName}' contains an unresolved marker`);
  }
  return rendered;
}

/** Remove source-control metadata before prompt text reaches the model. */
export function stripAuthorComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}
