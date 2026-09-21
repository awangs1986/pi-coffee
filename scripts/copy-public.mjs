import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
await mkdir(resolve(root, "dist/public"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });

// Browser-side libraries the shell imports as flat ES modules. They are copied
// from node_modules at build time so the served `public/` needs no bundler and
// the versions stay pinned by package-lock. Both are MIT.
const vendor = [
  ["marked", "vendor-marked.js"],
  ["dompurify", "vendor-purify.js"],
];
for (const [source, target] of vendor) {
  const from = fileURLToPath(import.meta.resolve(source));
  await cp(from, resolve(root, "dist/public", target));
  // Keep the source public/ usable for the vitest Web Server too.
  await cp(from, resolve(root, "public", target));
}

// Prompt fixtures are source-controlled markdown so they remain reviewable;
// copy them beside the compiled renderer for packaged/runtime use.
await rm(resolve(root, "dist/src/harness/prompts"), { recursive: true, force: true });
await mkdir(resolve(root, "dist/src/harness/prompts"), { recursive: true });
await cp(resolve(root, "src/harness/prompts"), resolve(root, "dist/src/harness/prompts"), { recursive: true });

await rm(resolve(root, "dist/skills"), { recursive: true, force: true });
await cp(resolve(root, "skills"), resolve(root, "dist/skills"), { recursive: true });
await mkdir(resolve(root, "dist/bin"), { recursive: true });
await cp(resolve(root, "src/lsp/coffee-lsp-launcher.mjs"), resolve(root, "dist/bin/coffee-lsp"));
await import("node:fs/promises").then(({ chmod }) => chmod(resolve(root, "dist/bin/coffee-lsp"), 0o755));

await mkdir(resolve(root, "dist/src/subagents"), { recursive: true });
await cp(resolve(root, "src/subagents/launch.py"), resolve(root, "dist/src/subagents/launch.py"));
await cp(resolve(root, "src/host/import-zip.py"), resolve(root, "dist/src/host/import-zip.py"));
