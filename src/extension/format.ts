import { isAbsolute, relative, sep } from "node:path";
import type { LspEnvelope } from "./query.js";

const SYMBOL_KINDS: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type parameter",
};

const SEVERITIES: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

export function symbolKindName(kind: unknown): string {
  return (typeof kind === "number" && SYMBOL_KINDS[kind]) || "symbol";
}

export function severityName(severity: unknown): string {
  return (typeof severity === "number" && SEVERITIES[severity]) || "diagnostic";
}

export function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const value = relative(cwd, path);
  if (!value) return ".";
  return value.startsWith(`..${sep}`) || value === ".." ? path : value;
}

function position(location: any): string {
  return location ? `${location.line}:${location.column}` : "?:?";
}

/**
 * Compact, model-facing rendering of a CLI envelope. The JSON contract stays
 * available to Bash callers; this text costs a fraction of the tokens.
 */
export function formatEnvelope(envelope: LspEnvelope, cwd: string): string {
  const lines: string[] = [];
  const server = envelope.server?.id ?? "unknown";
  const items = envelope.items ?? [];
  const issues = envelope.issues ?? [];
  const path = (value: string) => displayPath(value, cwd);

  switch (envelope.operation) {
    case "status": {
      const state = envelope.server?.state ?? envelope.status;
      const role = envelope.server?.role === "linter" ? " (lint only)" : "";
      const language = envelope.server?.language ? ` for ${envelope.server.language}` : "";
      lines.push(`lsp status: ${server} server ${state}${role}${language}`);
      if (envelope.projectRoot)
        lines.push(`project root: ${path(envelope.projectRoot)}`);
      if (envelope.capabilities?.length && envelope.status === "ok")
        lines.push(
          `operations: ${envelope.capabilities.join(", ")} (capabilities are negotiated on first use)`,
        );
      break;
    }
    case "symbols": {
      lines.push(`${items.length} symbol${items.length === 1 ? "" : "s"} (${server})`);
      for (const item of items) {
        const container = item.container ? ` (in ${item.container})` : "";
        lines.push(
          `  ${position(item.location)}  ${symbolKindName(item.kind)} ${item.name}${container}`,
        );
      }
      break;
    }
    case "definition":
    case "references":
    case "implementation": {
      const noun =
        envelope.operation === "references"
          ? "reference"
          : envelope.operation === "definition"
            ? "definition"
            : "implementation";
      lines.push(`${items.length} ${noun}${items.length === 1 ? "" : "s"} (${server})`);
      for (const item of items) {
        const snippet = item.snippet ? `  ${String(item.snippet).trim()}` : "";
        lines.push(`  ${path(item.path)}:${position(item.location)}${snippet}`);
      }
      break;
    }
    case "hover": {
      if (items.length === 0) lines.push(`hover: no information at this position (${server})`);
      for (const item of items) lines.push(String(item.text ?? "").trim());
      break;
    }
    case "diagnostics": {
      lines.push(...formatDiagnosticsLines(envelope, cwd));
      break;
    }
    case "servers": {
      lines.push(...formatServersLines(envelope));
      break;
    }
    case "install": {
      const command = envelope.server?.command;
      lines.push(
        envelope.status === "ok"
          ? `installed ${server}: ${command ?? "available"} (managed prefix ${envelope.managedPrefix ?? "?"})`
          : `install ${server}: ${envelope.status}`,
      );
      break;
    }
    default:
      lines.push(`lsp ${envelope.operation}: ${envelope.status}`);
  }

  if (items.length === 0 && envelope.emptyReason === "no_match")
    lines.push("  (no match for this position; verify the symbol position with symbols or the file)");
  if (envelope.coverage?.truncated)
    lines.push("  (more results were truncated; narrow the query or raise the limit)");
  for (const issue of issues) lines.push(`! ${issue.code}: ${issue.message}`);
  if (envelope.nextAction) lines.push(`next: ${envelope.nextAction}`);
  return lines.join("\n");
}

export function formatServersLines(envelope: LspEnvelope): string[] {
  const items = envelope.items ?? [];
  const available = items.filter((item) => item.status === "available");
  const missing = items.filter((item) => item.status === "missing");
  const disabled = items.filter((item) => item.status === "disabled");
  const lines = [
    `language servers: ${available.length} available, ${missing.length} not installed, ${disabled.length} disabled${envelope.managedPrefix ? ` (managed prefix ${envelope.managedPrefix})` : ""}`,
  ];
  const describe = (item: any) =>
    `${item.id}${item.role === "linter" ? " (lint only)" : ""}${item.configured ? " (coffee-lsp.json)" : ""}: ${item.language} [${item.fileTypes.join(" ")}]`;
  for (const item of available)
    lines.push(`  + ${describe(item)} → ${item.command}${item.source ? ` (${item.source})` : ""}`);
  for (const item of missing)
    lines.push(`  - ${describe(item)}${item.install ? ` → ${item.install}` : ""}${item.note ? ` (${item.note})` : ""}`);
  for (const item of disabled) lines.push(`  · ${describe(item)} disabled`);
  return lines;
}

export function formatDiagnosticsLines(envelope: LspEnvelope, cwd: string): string[] {
  const server = envelope.server?.id ?? "unknown";
  const items = envelope.items ?? [];
  const files = new Set(items.map((item) => item.path));
  const summary = summarizeSeverities(items);
  const lines: string[] = [];
  const requested = envelope.coverage?.requestedFiles;
  const confirmed = envelope.coverage?.confirmedFiles;
  const scope =
    requested !== undefined && requested > 1
      ? ` in ${files.size || 0}/${requested} files`
      : "";
  if (envelope.diagnosticState === "clean")
    lines.push(`diagnostics: clean (${server}, ${requested ?? 1} file${requested === 1 ? "" : "s"} confirmed)`);
  else if (envelope.diagnosticState === "findings")
    lines.push(`diagnostics: ${summary}${scope} (${server})`);
  else
    lines.push(
      `diagnostics: inconclusive (${server}; confirmed ${confirmed ?? 0}/${requested ?? "?"} files) — not evidence of a clean file`,
    );
  for (const item of items) lines.push(`  ${formatDiagnostic(item, cwd)}`);
  return lines;
}

export function formatDiagnostic(item: any, cwd: string): string {
  const code = item.code !== undefined && item.code !== null ? ` ${item.source ? `${item.source}(${item.code})` : item.code}` : item.source ? ` ${item.source}` : "";
  const message = String(item.message ?? "").replace(/\s+/g, " ").trim();
  return `${displayPath(item.path, cwd)}:${position(item.location)} ${severityName(item.severity)}${code}: ${message}`;
}

export function summarizeSeverities(items: any[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = severityName(item.severity);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const order = ["error", "warning", "info", "hint", "diagnostic"];
  const parts = order
    .filter((name) => counts.has(name))
    .map((name) => `${counts.get(name)} ${name}${counts.get(name) === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "no diagnostics";
}
