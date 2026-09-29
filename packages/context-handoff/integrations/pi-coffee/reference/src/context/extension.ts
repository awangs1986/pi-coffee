import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";
import { resolveContextFoldPackage } from "../pi-extensions.js";

/** Native compaction owns both modes. Keep only read-only legacy fold recovery. */
export default async function contextExtension(pi: ExtensionAPI): Promise<void> {
  const imported = await createJiti(import.meta.url, { moduleCache: false }).import(resolveContextFoldPackage(), { default: true });
  const factory = (imported as { default?: unknown }).default ?? imported;
  if (typeof factory !== "function") throw new Error("context-fold recovery entry is unavailable");
  const api = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") return (name: string, handler: (...args: any[]) => any) => {
        // Restore persisted registries for recall, but do not fold, compact,
        // observe turns or offer upstream session rollover behind the Host.
        if (!["session_start", "session_shutdown"].includes(name)) return;
        (target.on as any).call(target, name, handler);
      };
      if (property === "registerTool") return (tool: any) => {
        if (tool.name === "recall_folded") target.registerTool(tool);
      };
      if (property === "registerCommand") return () => undefined;
      return Reflect.get(target, property, receiver);
    },
  });
  await factory(api);
  pi.registerCommand("context-recovery", {
    description: "Native Pi compaction in Chat and Work; read-only legacy evidence recovery.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Chat and Work use native Pi compaction with the selected model. Legacy folded evidence remains readable in Work. Automatic handoff is disabled.", "info");
    },
  });
}
