import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessMode } from "./mode.js";

const QUERY = "pi-coffee:harness-mode:query:v1";

/** Each Pi extension has its own API object; query the shared session event bus. */
export function registerHarnessMode(pi: ExtensionAPI, current: () => HarnessMode): void {
  pi.events?.on(QUERY, (request) => {
    if (request && typeof request === "object") (request as { mode?: HarnessMode }).mode = current();
  });
}

export function currentHarnessMode(pi: ExtensionAPI): HarnessMode | undefined {
  const request: { mode?: HarnessMode } = {};
  pi.events?.emit(QUERY, request);
  // Standalone extensions without the Coffee harness retain their native behavior.
  return request.mode;
}

export function subagentsAllowed(pi: ExtensionAPI): boolean {
  return currentHarnessMode(pi) !== "chat";
}

/** Foreground children share the parent process in recent pi-subagents releases. */
export function isSubagentChild(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  if (process.env.PI_SUBAGENT_CHILD === "1") return true;
  const rootSession = process.env.PI_COFFEE_MAIN_SESSION ?? process.env.PI_COFFEE_ROOT_SESSION;
  return rootSession !== undefined && rootSession !== ctx.sessionManager.getSessionId();
}
