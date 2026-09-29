import { CHAT_TOOLS, HANDOFF_TOOLS } from "./mode.js";
/** Remove provider system-instruction fields, without rewriting user/tool content. */
export function chatPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const result = { ...payload } as Record<string, unknown>;
  // Native packages may restore their loader after Harness's before_agent_start.
  // Enforce Chat's model-facing boundary on the actual outgoing schemas too.
  if (Array.isArray(result.tools)) result.tools = chatToolsOnly(result.tools);
  for (const key of ["system", "instructions", "systemInstruction", "system_instruction"]) delete result[key];
  for (const key of ["messages", "input", "contents"]) {
    if (Array.isArray(result[key])) result[key] = result[key].filter((message: unknown) => {
      const role = message && typeof message === "object" ? (message as { role?: unknown }).role : undefined;
      return role !== "system" && role !== "developer";
    });
  }
  // Google SDK request config contains systemInstruction on some transports.
  if (result.config && typeof result.config === "object") {
    const config = { ...result.config } as Record<string, unknown>;
    if (Array.isArray(config.tools)) config.tools = chatToolsOnly(config.tools);
    delete config.systemInstruction;
    delete config.system_instruction;
    result.config = config;
  }
  return result;
}

const ALLOWED_TOOLS = new Set<string>([...CHAT_TOOLS, ...HANDOFF_TOOLS]);
function chatToolsOnly(tools: unknown[]): unknown[] {
  return tools.flatMap(tool => {
    if (!tool || typeof tool !== "object") return [tool];
    const record = tool as Record<string, any>;
    if (!Array.isArray(record.functionDeclarations) && !ALLOWED_TOOLS.has(record.name ?? record.function?.name)) return [];
    if (Array.isArray(record.functionDeclarations)) {
      const declarations = chatToolsOnly(record.functionDeclarations);
      return declarations.length ? [{ ...record, functionDeclarations: declarations }] : [];
    }
    return [tool];
  });
}
