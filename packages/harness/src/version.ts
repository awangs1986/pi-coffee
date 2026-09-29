import { readFileSync } from "node:fs";

/** Read the installed package's version; package.json is the single source. */
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
