import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installSubagentModelPolicy } from "./model-policy.js";

// Resolve the package without importing its TypeScript source. Node's native
// ESM loader intentionally refuses type stripping for files under
// node_modules; Pi's own extension loader (jiti) is the code that loads the
// upstream `.ts` entry passed separately by the Host.
const resolvePackage = createRequire(import.meta.url).resolve;
const packageEntry = resolvePackage("pi-subagents");
const packageRoot = dirname(packageEntry);

/**
 * PI Coffee's packaged pi-subagents resource Adapter.
 *
 * The upstream factory is loaded unchanged as a separate native Pi extension
 * entry. This Adapter only exposes the package's shipped skills and prompt
 * templates through Pi's resource discovery seam, which is not reached by an
 * explicit `--extension` path alone.
 */
export default function piCoffeeSubagentsResources(pi: ExtensionAPI): void {
  installSubagentModelPolicy(pi);
  pi.on("resources_discover", () => ({
    skillPaths: [join(packageRoot, "skills")],
    promptPaths: [join(packageRoot, "prompts")],
  }));
}
