import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
await mkdir(resolve(root, "dist/public"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });

// Prompt fixtures are source-controlled markdown so they remain reviewable;
// copy them beside the compiled renderer for packaged/runtime use.
await mkdir(resolve(root, "dist/src/harness/prompts"), { recursive: true });
await cp(resolve(root, "src/harness/prompts"), resolve(root, "dist/src/harness/prompts"), { recursive: true });
