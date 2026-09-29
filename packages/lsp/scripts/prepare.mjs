// `npm install` lifecycle hook. Builds `dist/` when the toolchain is present;
// `pi install git:...` runs `npm install --omit=dev`, where TypeScript is missing
// and a failing prepare would abort the whole install.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

let toolchain = true;
try {
  require.resolve("typescript/package.json", { paths: [root] });
} catch {
  toolchain = false;
}

if (!toolchain) {
  const built = existsSync(join(root, "dist", "src", "extension", "index.js"));
  console.error(
    built
      ? "pi-coffee-lsp: TypeScript not installed, keeping the existing dist/ build."
      : "pi-coffee-lsp: TypeScript not installed and dist/ is missing. Run `npm install && npm run build` in the package directory, or install from npm (`pi install npm:pi-coffee-lsp`).",
  );
  process.exit(0);
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
