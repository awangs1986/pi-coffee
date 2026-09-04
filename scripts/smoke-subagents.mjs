import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { resolvePiExtensions } from "../dist/src/pi-extensions.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeRoot = await mkdtemp(join(tmpdir(), "pi-coffee-subagents-smoke-"));
const agentDir = join(smokeRoot, "agent");
const inspectionPath = join(smokeRoot, "tools.json");
const inspectionExtension = join(smokeRoot, "inspect.mjs");
await writeFile(
  inspectionExtension,
  `import { writeFileSync } from "node:fs";\nexport default function (pi) {\n  pi.on("session_start", () => {\n    const all = pi.getAllTools();\n    writeFileSync(process.env.PI_COFFEE_SUBAGENTS_INSPECT_PATH, JSON.stringify({ all: all.map((tool) => tool.name), active: pi.getActiveTools() }));\n  });\n}\n`,
);
const extensions = resolvePiExtensions({
  PI_COFFEE_EXTENSIONS: "",
  PI_COFFEE_SUBAGENTS: "",
  // Keep the smoke process hermetic: the child Pi uses this temporary agent
  // directory, so the resolver must not accidentally select a globally
  // installed context-fold copy from the developer's home directory.
  PI_COFFEE_AGENT_DIR: agentDir,
});
const client = new RpcClient({
  cliPath: join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  cwd: root,
  env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_COFFEE_SUBAGENTS_INSPECT_PATH: inspectionPath },
  args: ["--offline", "--no-session", ...extensions.flatMap((path) => ["--extension", path]), "--extension", inspectionExtension],
});
const extensionErrors = [];
const unsubscribe = client.onEvent((event) => {
  if (event.type === "extension_error") extensionErrors.push(event);
});

try {
  await client.start();
  await client.newSession();
  const inspection = await readJsonWhenReady(inspectionPath);
  const commands = await client.getCommands();
  const names = new Set(commands.map((command) => command.name));
  const required = ["subagents", "subagents-doctor", "subagents-fleet", "parallel-review", "review-loop", "context-fold", "websearch", "subagents-model"];
  const missing = required.filter((name) => !names.has(name));
  const expectedSimple = ["read", "bash", "edit", "write", "grep", "find", "ls", "search_tools"];
  if (inspection.all.includes("subagent") !== true || inspection.all.includes("bg_wait") !== true) {
    throw new Error(`pi-subagents tools were not registered: ${JSON.stringify(inspection)}`);
  }
  const requiredWebTools = ["web_search", "research_seal", "fetch_content", "source_check", "get_search_content"];
  const missingWebTools = requiredWebTools.filter((name) => !inspection.all.includes(name));
  if (missingWebTools.length > 0) {
    throw new Error(`web extension tools were not registered: ${missingWebTools.join(", ")}`);
  }
  if (!inspection.all.includes("recall_folded") || !inspection.all.includes("unfold")) {
    throw new Error(`context-fold tools were not registered: ${JSON.stringify(inspection)}`);
  }
  if (JSON.stringify(inspection.active) !== JSON.stringify(expectedSimple)) {
    throw new Error(`Harness Simple table changed: ${JSON.stringify(inspection.active)}`);
  }
  if (extensionErrors.length > 0) throw new Error(`Pi extension errors: ${JSON.stringify(extensionErrors)}`);
  if (missing.length > 0) throw new Error(`Missing pi-subagents commands: ${missing.join(", ")}`);
  console.log(JSON.stringify({
    ok: true,
    piSubagents: "0.63.0",
    contextFold: "0.4.0",
    extensions,
    harnessSimpleActive: inspection.active,
    optionalToolsRegistered: ["subagent", "bg_wait"].filter((name) => inspection.all.includes(name)),
    commands: required,
  }, null, 2));
} finally {
  unsubscribe();
  await client.stop();
  await rm(smokeRoot, { recursive: true, force: true });
}

async function readJsonWhenReady(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
  throw new Error(`Timed out waiting for tool inspection at ${path}`);
}
