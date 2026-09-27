import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";
import { resolvePiExtensions } from "./pi-extensions.js";

/** Native Pi package entry; share the same ordered configuration as embedded consumers. */
export default async function coffee(pi: ExtensionAPI): Promise<void> {
  const loader = createJiti(import.meta.url, { moduleCache: false });
  for (const path of resolvePiExtensions()) {
    const imported = await loader.import(path, { default: true });
    const factory = (imported as { default?: unknown })?.default ?? imported;
    if (typeof factory !== "function") throw new Error(`Pi extension has no callable entry: ${path}`);
    await factory(pi);
  }
}
