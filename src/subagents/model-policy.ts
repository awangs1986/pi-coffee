import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_FILE = "settings.json";
const MAX_MODEL_LENGTH = 256;
const CLEAR_VALUES = new Set(["off", "clear", "none"]);

export interface SubagentModelPolicyOptions {
  /** Injectable path for tests; production uses the user's Pi agent directory. */
  settingsPath?: string;
}

export function defaultSubagentSettingsPath(): string {
  const agentDir = process.env.PI_COFFEE_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
  return join(agentDir, SETTINGS_FILE);
}

export async function readGlobalSubagentModel(settingsPath = defaultSubagentSettingsPath()): Promise<string | undefined> {
  const settings = await readSettings(settingsPath);
  const subagents = settings.subagents;
  if (!isRecord(subagents)) return undefined;
  return typeof subagents.defaultModel === "string" && subagents.defaultModel.trim()
    ? subagents.defaultModel.trim()
    : undefined;
}

export async function setGlobalSubagentModel(model: string, settingsPath = defaultSubagentSettingsPath()): Promise<string> {
  const normalized = validateModel(model);
  const settings = await readSettings(settingsPath);
  const subagents = isRecord(settings.subagents) ? { ...settings.subagents } : {};
  subagents.defaultModel = normalized;
  settings.subagents = subagents;
  await writeSettings(settingsPath, settings);
  return normalized;
}

export async function clearGlobalSubagentModel(settingsPath = defaultSubagentSettingsPath()): Promise<void> {
  const settings = await readSettings(settingsPath);
  if (!isRecord(settings.subagents)) return;
  const subagents = { ...settings.subagents };
  delete subagents.defaultModel;
  if (Object.keys(subagents).length === 0) delete settings.subagents;
  else settings.subagents = subagents;
  await writeSettings(settingsPath, settings);
}

/** Register the global model command without coupling PI Coffee to upstream internals. */
export function installSubagentModelPolicy(
  pi: ExtensionAPI,
  options: SubagentModelPolicyOptions = {},
): void {
  // Resource-only test adapters may expose just resources_discover. The real
  // Pi ExtensionAPI always provides registerCommand, but keep this seam
  // composable for adapters that intentionally expose no command surface.
  if (typeof pi.registerCommand !== "function") return;
  const settingsPath = options.settingsPath ?? defaultSubagentSettingsPath();
  pi.registerCommand("subagents-model", {
    description: "Show or set the global pi-subagents model: /subagents-model [provider/model|off]",
    handler: async (args, ctx) => {
      const value = args.trim();
      try {
        if (!value) {
          const current = await readGlobalSubagentModel(settingsPath);
          ctx.ui.notify(`global subagent model: ${current ?? "inherit parent model"}`, "info");
          return;
        }
        if (CLEAR_VALUES.has(value.toLowerCase())) {
          await clearGlobalSubagentModel(settingsPath);
          ctx.ui.notify("global subagent model cleared; children inherit the parent model", "info");
          return;
        }
        const model = await setGlobalSubagentModel(value, settingsPath);
        ctx.ui.notify(`global subagent model set to ${model}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`unable to update global subagent model: ${message}`, "error");
      }
    },
  });
}

function validateModel(value: string): string {
  const model = value.trim();
  if (!model) throw new Error("model must be a non-empty provider/model value");
  if (model.length > MAX_MODEL_LENGTH) throw new Error(`model must be at most ${MAX_MODEL_LENGTH} characters`);
  if (/\p{Cc}/u.test(model)) throw new Error("model contains control characters");
  return model;
}

async function readSettings(settingsPath: string): Promise<Record<string, any>> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("settings.json must contain a JSON object");
    return { ...parsed };
  } catch (error) {
    if (isMissingFile(error)) return {};
    if (error instanceof SyntaxError) throw new Error(`invalid JSON in ${settingsPath}`);
    throw error;
  }
}

async function writeSettings(settingsPath: string, settings: Record<string, any>): Promise<void> {
  const directory = dirname(settingsPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = join(directory, `.${SETTINGS_FILE}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, settingsPath);
    await chmod(settingsPath, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
