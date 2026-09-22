import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

function retiredModeNames(text: string): string[] {
  // Historical filenames/URLs remain valid citations, not selectable modes.
  const prose = text.replace(/https?:\/\/[^\s)<>]+/g, "")
    .replace(/[\w./-]+\.(?:md|ts|js|json)\b/g, "");
  return prose.match(/\b(?:simple|lean|full)\b/gi) ?? [];
}

describe("Chat/Work documentation contract", () => {
  it("detects retired commands, tables and prose while allowing source citations", () => {
    expect(retiredModeNames("/harness simple | Lean | Full")).toHaveLength(3);
    expect(retiredModeNames("Chat / Work [audit](docs/gitea-full-audit.md)")).toEqual([]);
  });

  it("keeps retired mode aliases out of the runtime contracts", () => {
    const contracts = ["harness/mode.ts", "harness/extension.ts", "harness/prompt.ts", "harness/runtime-mode.ts", "capabilities/catalog.ts", "capabilities/manifest-loader.ts", "capabilities/schema-budget.ts"];
    for (const path of contracts) expect(retiredModeNames(readFileSync(join(root, "src", path), "utf8")), path).toEqual([]);
  });

  it("keeps retired mode vocabulary out of every maintained Markdown document", () => {
    const hits = markdownFiles(root).flatMap((path) => readFileSync(path, "utf8").split("\n")
      .flatMap((line, index) => retiredModeNames(line).length ? [`${relative(root, path)}:${index + 1}`] : []));
    expect(hits, "Retire obsolete design text; do not rename old behavior to Chat/Work").toEqual([]);
  });
});
