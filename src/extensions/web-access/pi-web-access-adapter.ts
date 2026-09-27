import { createRequire } from "node:module";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";

const resolvePackage = createRequire(import.meta.url).resolve;
const packageEntry = resolvePackage("pi-web-access/index.ts");

/**
 * Load the official pi-web-access extension through Pi's native extension
 * manager while reserving the `web_search` name for PI Coffee's bounded
 * evidence adapter. That adapter calls the original package's Serper provider
 * but must prevent upstream web_search from persisting full results to Pi history.
 */
export default async function piWebAccessAdapter(pi: ExtensionAPI): Promise<void> {
  const loaded = await createJiti(import.meta.url, { moduleCache: false }).import(packageEntry, { default: true });
  const factory = (loaded as { default?: unknown }).default ?? loaded;
  if (typeof factory !== "function") throw new Error("pi-web-access does not export an extension factory");

  const isolatedApi = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") {
        return (tool: ToolDefinition) => {
          if (tool.name === "web_search") return;
          return target.registerTool(tool);
        };
      }
      if (property === "registerCommand") {
        return (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
          // Official curator/search commands bypass Coffee's evidence limit.
          if (name === "websearch" || name === "curator") return;
          return target.registerCommand(name, command);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  await (factory as (api: ExtensionAPI) => void | Promise<void>)(isolatedApi);
}

export function resolvePiWebAccessPackage(): string {
  return packageEntry;
}
