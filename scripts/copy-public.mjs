import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
await mkdir(resolve(root, "dist/public"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "dist/public"), { recursive: true });
