import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HarnessMode } from "./mode.js";

const QUERY = "pi-coffee:harness-mode:query:v1";

/** Each Pi extension has its own API object; query the shared session event bus. */
export function registerHarnessMode(pi: ExtensionAPI, current: () => HarnessMode): void {
  pi.events?.on(QUERY, (request) => {
    if (request && typeof request === "object") (request as { mode?: HarnessMode }).mode = current();
  });
}

export function subagentsAllowed(pi: ExtensionAPI): boolean {
  const request: { mode?: HarnessMode } = {};
  pi.events?.emit(QUERY, request);
  // Standalone extensions without the Coffee harness retain their native behavior.
  return request.mode !== "simple";
}
