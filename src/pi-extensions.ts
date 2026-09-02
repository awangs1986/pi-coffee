import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const resolvePackage = createRequire(import.meta.url).resolve;

/**
 * Resolve the native extension entries loaded by every Agent Host session.
 *
 * `PI_COFFEE_EXTENSIONS` is an explicit replacement list. With no override,
 * PI Coffee loads its Harness, the pinned upstream pi-subagents entry, and a
 * tiny resource Adapter for the package's shipped skills/prompts. The
 * subagent tool remains optional in the Harness table; loading an extension
 * does not activate its tools.
 */
export function resolvePiExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.PI_COFFEE_EXTENSIONS?.trim();
  if (configured === "off") return [];
  if (configured !== undefined && configured.length > 0) {
    return configured.split(delimiter).map((value) => value.trim()).filter((value) => value.length > 0);
  }

  const harness = resolveHarnessExtension();
  if (isDisabled(env.PI_COFFEE_SUBAGENTS)) return [harness];
  return [harness, resolvePiSubagentsExtension(), resolvePiSubagentsResourceExtension()];
}

export function resolveHarnessExtension(): string {
  return join(moduleDirectory, "harness", "extension.js");
}

/** Resolve the official package entry; Pi's loader handles its TypeScript source. */
export function resolvePiSubagentsExtension(): string {
  return resolvePackage("pi-subagents");
}

export function resolvePiSubagentsResourceExtension(): string {
  return join(moduleDirectory, "subagents", "extension.js");
}

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
