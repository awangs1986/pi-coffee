/** Product modes and their exact resident tool contracts. */
export type HarnessMode = "chat" | "work";
export const CHAT_TOOLS = ["read", "edit", "write", "bash", "web_search"] as const;
export const WORK_TOOLS = ["read", "edit", "write", "bash", "git", "search_tools"] as const;
export type HarnessToolName = (typeof CHAT_TOOLS)[number] | (typeof WORK_TOOLS)[number];

export function toolsForMode(mode: HarnessMode): readonly string[] {
  return mode === "chat" ? CHAT_TOOLS : WORK_TOOLS;
}
export function promptProfileForMode(mode: HarnessMode): "none" | "work" {
  return mode === "chat" ? "none" : "work";
}
export function resolveToolTable(mode: HarnessMode, available: Iterable<string>): {
  desired: readonly string[]; active: string[]; missing: string[]; ready: boolean;
} {
  const registered = new Set(available);
  const desired = toolsForMode(mode);
  const active: string[] = desired.filter(name => registered.has(name));
  if (mode === "work" && registered.has("recall_folded")) active.push("recall_folded");
  if (mode === "work") {
    // The official loader owns activation of the delegation schema; no Coffee proxy.
    for (const name of ["subagents_enable", "bg_wait", "subagent_supervisor"]) {
      if (registered.has(name)) active.push(name);
    }
  }
  const missing = desired.filter(name => !registered.has(name));
  return { desired, active, missing, ready: missing.length === 0 };
}
