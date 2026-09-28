import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await rm(resolve(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", resolve(root, "tsconfig.json")], { cwd: root, stdio: "inherit" });
await mkdir(resolve(root, "dist/harness/prompts"), { recursive: true });
await cp(resolve(root, "src/harness/prompts"), resolve(root, "dist/harness/prompts"), { recursive: true });
