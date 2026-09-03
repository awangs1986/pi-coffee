import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { resolvePiExtensions } from "../dist/src/pi-extensions.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeRoot = await mkdtemp(join(tmpdir(), "pi-coffee-web-smoke-"));
const agentDir = join(smokeRoot, "agent");
const inspectionPath = join(smokeRoot, "tools.json");
const inspectionExtension = join(smokeRoot, "inspect.mjs");

await writeFile(
  inspectionExtension,
  `import { writeFileSync } from "node:fs";\nexport default function (pi) {\n  pi.on("session_start", () => {\n    writeFileSync(process.env.PI_COFFEE_WEB_INSPECT_PATH, JSON.stringify({ all: pi.getAllTools().map((tool) => tool.name), active: pi.getActiveTools() }));\n  });\n}\n`,
);

const extensions = resolvePiExtensions({
  PI_COFFEE_EXTENSIONS: "",
  PI_COFFEE_SUBAGENTS: "",
  PI_COFFEE_AGENT_DIR: agentDir,
});
const client = new RpcClient({
  cliPath: join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  cwd: root,
  env: {
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_COFFEE_WEB_INSPECT_PATH: inspectionPath,
  },
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
  const requiredTools = ["web_search", "research_seal", "fetch_content", "source_check", "get_search_content"];
  const missingTools = requiredTools.filter((name) => !inspection.all.includes(name));
  if (missingTools.length > 0) throw new Error(`Missing Web tools: ${missingTools.join(", ")}`);
  if (!inspection.all.includes("subagent") || !inspection.all.includes("bg_wait")) {
    throw new Error(`pi-subagents tools were not registered: ${JSON.stringify(inspection)}`);
  }
  if (!inspection.all.includes("recall_folded") || !inspection.all.includes("unfold")) {
    throw new Error(`context-fold tools were not registered: ${JSON.stringify(inspection)}`);
  }
  const websearch = commands.find((command) => command.name === "websearch");
  if (!websearch) throw new Error("Missing /websearch command");
  if (!websearch.description.includes("PI Coffee Control Plane")) {
    throw new Error(`Official curator command replaced PI Coffee /websearch: ${websearch.description}`);
  }
  if (extensionErrors.length > 0) throw new Error(`Pi extension errors: ${JSON.stringify(extensionErrors)}`);
  console.log(JSON.stringify({
    ok: true,
    webTools: requiredTools,
    piSubagentsTools: ["subagent", "bg_wait"],
    contextFoldTools: ["recall_folded", "unfold"],
    command: "websearch",
    extensions,
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
