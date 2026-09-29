import { createRequire } from "node:module";

/** Read the installed package's version; package.json is the single source. */
export const PACKAGE_VERSION: string = createRequire(import.meta.url)("pi-coffee-lsp/package.json").version;
