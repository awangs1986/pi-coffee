import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

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

await cp(resolve(root, "third_party/oh-my-pi"), resolve(root, "dist/third_party/oh-my-pi"), { recursive: true });
