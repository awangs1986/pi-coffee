import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// One implementation, two distribution boundaries. Never ship the aggregate loader.
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, "packages/pi-coffee-harness/dist");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of ["harness", "capabilities"]) {
  await cp(resolve(root, "dist/src", path), resolve(target, path), { recursive: true, filter: path => !path.endsWith(".map") });
}
await mkdir(resolve(target, "extensions/web-access"), { recursive: true });
for (const file of ["capability.js", "capability.d.ts"]) {
  await cp(resolve(root, "dist/src/extensions/web-access", file), resolve(target, "extensions/web-access", file));
}
