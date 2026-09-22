/** Remove provider system-instruction fields, without rewriting user/tool content. */
export function chatPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const result = { ...payload } as Record<string, unknown>;
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
    delete config.systemInstruction;
    delete config.system_instruction;
    result.config = config;
  }
  return result;
}
