import { cp, mkdir, chmod } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await cp(new URL("skills", root), new URL("dist/skills", root), { recursive: true });
await mkdir(new URL("dist/bin", root), { recursive: true });
await cp(new URL("src/lsp/coffee-lsp-launcher.mjs", root), new URL("dist/bin/coffee-lsp", root));
await chmod(new URL("dist/bin/coffee-lsp", root), 0o755);
await cp(new URL("third_party/oh-my-pi", root), new URL("dist/third_party/oh-my-pi", root), { recursive: true });
