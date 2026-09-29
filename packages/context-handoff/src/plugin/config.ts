import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Invalid owner configuration: never silently replaced by native recovery. */
export class ConfigError extends Error {}

export function registerPolicy(pi: ExtensionAPI) {
  for (const [name, description] of Object.entries({
    "handoff-output-tokens": "Synthesis output budget, including reasoning (default 16384 with reasoning, 4096 off; bounded by model)",
    "handoff-timeout-ms": "Synthesis deadline (default 120000 with reasoning, 60000 off)",
  })) pi.registerFlag(name, { type: "string", description });
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = pi.getFlag(name) ?? String(fallback), n = Number(raw);
    if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
    return n;
  };
  return {
    generation: (model: { maxTokens: number; contextWindow: number; reasoning: boolean }) => {
      const thinking = pi.getThinkingLevel();
      const reasoning = model.reasoning && thinking !== "off" ? thinking : undefined;
      const requestedTokens = integer("handoff-output-tokens", reasoning ? 16384 : 4096, 1024, 65536);
      const outputTokens = Math.min(requestedTokens, model.maxTokens, Math.floor(model.contextWindow / 2));
      if (outputTokens < 1024) throw new Error("Model has insufficient Handoff output capacity");
      return {
        thinking,
        reasoning,
        outputTokens,
        timeoutMs: integer("handoff-timeout-ms", reasoning ? 120000 : 60000, 100, 300000),
      };
    },
  };
}
