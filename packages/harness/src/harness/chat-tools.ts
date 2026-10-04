import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const QUERY = "pi-coffee:chat-tools:query:v1";

/** Declare installed extension tools compatible with Chat; does not activate or authorize them. */
export function registerChatTools(pi: ExtensionAPI, names: readonly string[]): void {
  const tools = [...new Set(names.filter(name => /^[a-zA-Z0-9_-]{1,128}$/.test(name)))];
  pi.events?.on(QUERY, (request: unknown) => {
    if (request && typeof request === "object" && "tools" in request && Array.isArray(request.tools)) request.tools.push(...tools);
  });
}

/** Registration crosses extension API instances through Pi's public synchronous event bus. */
export function registeredChatTools(pi: ExtensionAPI): string[] {
  const request = { tools: [] as string[] };
  pi.events?.emit(QUERY, request);
  const installed = new Set(pi.getAllTools().map(tool => tool.name));
  return [...new Set(request.tools)].filter(name => typeof name === "string" && installed.has(name));
}
