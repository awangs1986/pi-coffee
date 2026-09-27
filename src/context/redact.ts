import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function redactSecrets(value: string): string {
  const secrets = [
    process.env.PI_COFFEE_UPSTREAM_KEY,
    process.env.PI_COFFEE_RELAY_TOKEN,
    process.env.PI_COFFEE_SERPER_KEY,
    process.env.SERPER_API_KEY,
    configuredSerperKey(),
  ].filter((secret): secret is string => typeof secret === "string" && secret.length > 3);
  return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
}

function configuredSerperKey(): string | undefined {
  const configDir = process.env.PI_CODING_AGENT_DIR
    || (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "pi") : join(homedir(), ".pi"));
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(configDir, "web-search.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const key = (parsed as Record<string, unknown>).serperApiKey;
    return typeof key === "string" ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}
