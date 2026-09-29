import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectSnapshot, sourceChanges } from "../src/lsp/snapshot.js";

function touch(path: string, seconds: number): void {
  utimesSync(path, seconds, seconds);
}

describe("project snapshot", () => {
  it("skips engine, framework and gitignored output directories", () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-snapshot-"));
    try {
      mkdirSync(join(root, "Assets/Scripts"), { recursive: true });
      writeFileSync(
        join(root, "Assets/Scripts/Player.cs"),
        "class Player {}\n",
      );
      writeFileSync(join(root, "Game.csproj"), "<Project />\n");
      // Unity's Library, Next.js' .next and a gitignored custom output directory
      // may hold any number of files without counting against the walk.
      for (const directory of [
        "Library/Artifacts",
        ".next/static/chunks",
        "generated/deep",
      ]) {
        mkdirSync(join(root, directory), { recursive: true });
        for (let index = 0; index < 30; index += 1)
          writeFileSync(join(root, directory, `${index}.js`), "");
      }
      writeFileSync(
        join(root, ".gitignore"),
        "# build output\n/generated/\n*.log\n!keep\n",
      );
      // The same name below the root is not covered by the root-only .gitignore rule.
      mkdirSync(join(root, "src/generated"), { recursive: true });
      writeFileSync(join(root, "src/generated/schema.ts"), "export {};\n");
      writeFileSync(join(root, "src/app.ts"), "export {};\n");

      const snapshot = projectSnapshot(root, 50);
      expect(snapshot.truncated).toBe(false);
      expect(
        [...snapshot.sources.keys()]
          .map((path) => path.slice(root.length + 1))
          .sort(),
      ).toEqual([
        "Assets/Scripts/Player.cs",
        "src/app.ts",
        "src/generated/schema.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restarts only on real configuration changes and watches data files as sources", () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-snapshot-"));
    try {
      mkdirSync(join(root, "assets/levels"), { recursive: true });
      writeFileSync(join(root, "tsconfig.json"), "{}\n");
      writeFileSync(join(root, "package.json"), "{}\n");
      writeFileSync(join(root, "package-lock.json"), "{}\n");
      writeFileSync(join(root, "assets/levels/one.json"), "{}\n");
      writeFileSync(join(root, "main.gd"), "extends Node\n");
      for (const file of [
        "tsconfig.json",
        "package.json",
        "package-lock.json",
        "assets/levels/one.json",
        "main.gd",
      ])
        touch(join(root, file), 1_700_000_000);
      const before = projectSnapshot(root);
      expect(
        [...before.sources.keys()]
          .map((path) => path.slice(root.length + 1))
          .sort(),
      ).toEqual(["assets/levels/one.json", "main.gd", "package-lock.json"]);

      // npm install rewrote the lock file: a watched source change, not a restart.
      touch(join(root, "package-lock.json"), 1_700_000_100);
      touch(join(root, "assets/levels/one.json"), 1_700_000_100);
      const afterData = projectSnapshot(root);
      expect(afterData.configuration).toBe(before.configuration);
      expect(afterData.fingerprint).not.toBe(before.fingerprint);
      expect(
        sourceChanges(before, afterData).map((change) => [
          change.path.slice(root.length + 1),
          change.type,
        ]),
      ).toEqual([
        ["assets/levels/one.json", 2],
        ["package-lock.json", 2],
      ]);

      // tsconfig.json is a root marker of the TypeScript entry: configuration.
      touch(join(root, "tsconfig.json"), 1_700_000_200);
      expect(projectSnapshot(root).configuration).not.toBe(
        before.configuration,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("degrades instead of failing when a project exceeds the entry bound", () => {
    const root = mkdtempSync(join(tmpdir(), "coffee-lsp-snapshot-"));
    try {
      for (let index = 0; index < 20; index += 1)
        writeFileSync(join(root, `${index}.ts`), "");
      const bounded = projectSnapshot(root, 10);
      expect(bounded.truncated).toBe(true);
      expect(bounded.sources.size).toBe(10);
      // Deterministic order keeps the bounded fingerprint stable between calls.
      expect(projectSnapshot(root, 10).fingerprint).toBe(bounded.fingerprint);
      expect(projectSnapshot(root).truncated).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
