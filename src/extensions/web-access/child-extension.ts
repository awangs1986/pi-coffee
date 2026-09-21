import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebExtension } from "./extension.js";

/** A researcher performs the real search locally; it never delegates another researcher. */
export default function childWeb(pi: ExtensionAPI): void {
  createWebExtension({ delegateByDefault: false })(pi);
}
