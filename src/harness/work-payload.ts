export const HARNESS_BLOCK_PATTERN = /<pi_coffee_harness>[\s\S]*?<\/pi_coffee_harness>/g;

/** Refresh only our block in provider system fields; leave user/tool data untouched. */
export function refreshWorkPayload(payload: unknown, block: string): unknown {
  if (!isRecord(payload)) return payload;
  const result = { ...payload };
  for (const key of ["system", "instructions", "systemInstruction", "system_instruction"]) {
    if (key in result) result[key] = refreshText(result[key], block);
  }
  for (const key of ["messages", "input", "contents"]) {
    if (!Array.isArray(result[key])) continue;
    result[key] = result[key].map((message: unknown) => {
      if (!isRecord(message) || !["system", "developer"].includes(String(message.role))) return message;
      return refreshText(message, block);
    });
  }
  if (isRecord(result.config)) {
    const config = { ...result.config };
    for (const key of ["systemInstruction", "system_instruction"]) {
      if (key in config) config[key] = refreshText(config[key], block);
    }
    result.config = config;
  }
  return result;
}

function refreshText(value: unknown, block: string): unknown {
  if (typeof value === "string") return value.replace(HARNESS_BLOCK_PATTERN, () => block);
  if (Array.isArray(value)) return value.map(item => refreshText(item, block));
  if (!isRecord(value)) return value;
  const result = { ...value };
  for (const key of ["text", "content", "parts"]) {
    if (key in result) result[key] = refreshText(result[key], block);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
