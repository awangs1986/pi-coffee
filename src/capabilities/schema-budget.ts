import { createHash } from "node:crypto";

/** The schema-shaped subset needed by the discovery catalog. */
export interface ToolSchemaLike {
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * Optional schema budget.  The frozen V5 values are retained as defaults, but
 * the catalog owns the accounting so callers never need to know how schemas
 * are registered in Pi.
 */
export const SCHEMA_BUDGETS = Object.freeze({
  simple: 2_560,
  full: 4_096,
  epochCeiling: 8_192,
});

/** A deterministic JSON representation used for digests and token estimates. */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "undefined") return "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function serializeToolSchema(tool: ToolSchemaLike): string {
  return stableStringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
}

/** Calibrated against the V3/V5 convention of roughly three bytes per token. */
export function estimateSchemaTokens(tool: ToolSchemaLike): number {
  return Math.ceil(Buffer.byteLength(serializeToolSchema(tool), "utf8") / 3);
}

export function estimateSchemaTokensAll(tools: readonly ToolSchemaLike[]): number {
  return tools.reduce((total, tool) => total + estimateSchemaTokens(tool), 0);
}

export function digestToolSchema(tool: ToolSchemaLike): string {
  return createHash("sha256").update(serializeToolSchema(tool), "utf8").digest("hex");
}
