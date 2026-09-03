import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateManifest,
  type CapabilityManifest,
  type HarnessMode,
  type RunnerConformance,
} from "./catalog.js";

export interface ManifestLoadDiagnostic {
  path: string;
  message: string;
}
export interface ManifestLoadOptions {
  maxFiles?: number;
  maxBytesPerFile?: number;
  conformanceFor?: (id: string) => RunnerConformance;
}

export interface ManifestLoadReport {
  manifests: CapabilityManifest[];
  diagnostics: ManifestLoadDiagnostic[];
}

/**
 * Read-only discovery of JSON manifests. It never imports or executes code;
 * the Pi extension/runner is still responsible for registration at activate.
 */
export function loadCapabilityManifests(
  directories: readonly string[],
  options: ManifestLoadOptions = {},
): ManifestLoadReport {
  const maxFiles = options.maxFiles ?? 64;
  const maxBytes = options.maxBytesPerFile ?? 256 * 1024;
  const conformanceFor = options.conformanceFor ?? (() => "not_run" as const);
  const manifests: CapabilityManifest[] = [];
  const diagnostics: ManifestLoadDiagnostic[] = [];
  const ids = new Set<string>();
  let filesSeen = 0;

  for (const directory of directories) {
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch (error) {
      diagnostics.push({ path: directory, message: `cannot read capability directory: ${errorMessage(error)}` });
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".capability.json")) continue;
      if (filesSeen >= maxFiles) {
        diagnostics.push({ path: directory, message: `capability manifest limit (${maxFiles}) reached` });
        break;
      }
      filesSeen += 1;
      const path = join(directory, name);
      try {
        if (!lstatSync(path).isFile()) throw new Error("not a regular file");
        const raw = readFileSync(path, "utf8");
        if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes`);
        const parsed = JSON.parse(raw) as unknown;
        const manifest = parseManifest(parsed, conformanceFor);
        validateManifest(manifest);
        if (ids.has(manifest.id)) throw new Error(`duplicate capability id '${manifest.id}'`);
        ids.add(manifest.id);
        manifests.push(manifest);
      } catch (error) {
        diagnostics.push({ path, message: errorMessage(error) });
      }
    }
  }
  return { manifests, diagnostics };
}

function parseManifest(value: unknown, conformanceFor: (id: string) => RunnerConformance): CapabilityManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  const harness = value.supportedHarness;
  if (!Array.isArray(harness) || !harness.every((item): item is HarnessMode => item === "simple" || item === "full")) {
    throw new Error("supportedHarness must contain simple/full");
  }
  if (!Array.isArray(value.tools)) throw new Error("tools must be an array");
  const tools = value.tools.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || typeof tool.description !== "string") throw new Error("invalid tool schema");
    return { name: tool.name, description: tool.description, parameters: tool.parameters };
  });
  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.summary !== "string" || typeof value.permissionSummary !== "string") {
    throw new Error("id/title/summary/permissionSummary are required");
  }
  const keywords = Array.isArray(value.keywords) && value.keywords.every((item): item is string => typeof item === "string")
    ? value.keywords
    : [];
  return {
    id: value.id,
    kind: value.kind === "mcp-server" || value.kind === "skill" || value.kind === "builtin" ? value.kind : "pi-extension",
    origin: value.origin === "suite" || value.origin === "task" ? value.origin : "user",
    title: value.title,
    summary: value.summary,
    keywords: [...keywords],
    tools,
    supportedHarness: [...harness],
    permissionSummary: value.permissionSummary,
    // A manifest cannot self-attest runner conformance. The Host supplies this
    // evidence separately (normally after a real User VM smoke).
    runnerConformance: conformanceFor(value.id),
    supportsProxyCall: value.supportsProxyCall === true,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
