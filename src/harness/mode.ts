/**
 * The V5 harness contract, kept as a small pure module so the Pi extension
 * and its tests share one source of truth.  V5 is a frozen reference: this
 * file records its public tool table, not an import of V5 implementation.
 */

export type HarnessMode = "simple" | "full";
export type HarnessPromptProfile = "software-development";

/** The exact V5 Simple table (seven Pi built-ins plus search_tools). */
export const SIMPLE_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "search_tools",
] as const;

/** The exact V5 Full table (Simple plus git and verify). */
export const FULL_TOOLS = [...SIMPLE_TOOLS, "git", "verify"] as const;

export type HarnessToolName = (typeof FULL_TOOLS)[number];

/**
 * V3 compatibility names retained by V5.  PI Coffee does not create a third
 * tool table: both aliases resolve to Full, while `tdd` is guidance only.
 */
export function mapHarnessAlias(value: string): { mode: HarnessMode; alias: "standard" | "tdd" } | undefined {
  if (value === "standard" || value === "tdd") return { mode: "full", alias: value };
  return undefined;
}

export function toolsForMode(mode: HarnessMode): readonly string[] {
  return mode === "simple" ? SIMPLE_TOOLS : FULL_TOOLS;
}

export function promptProfileForMode(mode: HarnessMode): HarnessPromptProfile {
  return "software-development";
}

/**
 * Filter a desired V5 table against what this Pi process really registered.
 * `ready` is deliberately explicit: callers must not claim Full when a
 * required custom tool is absent.
 */
export function resolveToolTable(mode: HarnessMode, available: Iterable<string>): {
  desired: readonly string[];
  active: string[];
  missing: string[];
  ready: boolean;
} {
  const availableSet = new Set(available);
  const desired = toolsForMode(mode);
  const active: string[] = desired.filter((name) => availableSet.has(name));
  // Recovery is infrastructure, not an optional capability or a sticky unfold.
  if (availableSet.has("recall_folded")) active.push("recall_folded");
  const missing = desired.filter((name) => !availableSet.has(name));
  return { desired, active, missing, ready: missing.length === 0 };
}
