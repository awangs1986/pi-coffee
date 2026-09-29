import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Explicit Pi RPC marker. Host owns timing; the v1 manual transport stays compatible. */
export const HANDOFF_REQUEST = "context-handoff:manual:v1";
export const HANDOFF_VERSION: string = createRequire(import.meta.url)("context-handoff/package.json").version;
export const resolveHandoffExtension = () => fileURLToPath(new URL("./extension.js", import.meta.url));
