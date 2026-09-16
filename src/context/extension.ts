import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";
import { resolveContextFoldPackage } from "../pi-extensions.js";
import { installContextPolicy, protectLocalCompaction } from "./policy.js";

/** Original context-fold implementation, with local-only failure semantics at its public Pi seam. */
export default async function contextExtension(pi: ExtensionAPI): Promise<void> {
  installContextPolicy(pi);
  const imported = await createJiti(import.meta.url, { moduleCache: false }).import(resolveContextFoldPackage(), { default: true });
  const factory = (imported as { default?: unknown }).default ?? imported;
  if (typeof factory !== "function") throw new Error("context-fold extension entry is unavailable");
  let hasCompactionHandler = false;
  const api = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") return (name: string, handler: (...args: any[]) => any) => {
        if (name === "session_before_compact") hasCompactionHandler = true;
        const on = target.on as (name: string, handler: (...args: any[]) => any) => void;
        on.call(target, name, name === "session_before_compact" ? protectLocalCompaction(handler) : handler);
      };
      return Reflect.get(target, property, receiver);
    },
  });
  await factory(api);
  // Master disable of the package must not turn the Web recovery button into an LLM request.
  if (!hasCompactionHandler) pi.on("session_before_compact", protectLocalCompaction(() => undefined));
  // Loaded-state handshake for the Host: /context-fold alone may be an unwrapped package.
  pi.registerCommand("context-recovery", {
    description: "Local-only context recovery is installed; use the Web compact control or Pi /compact.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Local-only recovery adapter loaded. Large results are archived, recall_folded is available through Harness, and failed local compaction does not fall back to a model summary.", "info");
    },
  });
}
