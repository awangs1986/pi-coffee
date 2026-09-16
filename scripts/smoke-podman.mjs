#!/usr/bin/env node
// PI Coffee two-machine smoke on one workstation, using Podman.
//
//   server side  : container `pi-coffee-relay` (sole upstream key)  +  `pi-coffee-web` (Host token)
//   User VM side : container `pi-coffee-uservm` (Host token + Relay token, runs as user `runner`)
//
// Only the Web port is published (127.0.0.1:3300). Everything else talks over
// the private network `pi-coffee-smoke` by container name, exactly like two
// hosts would. Then the real-model smoke and a hostname/whoami tool probe run
// through the browser protocol, and the script asserts:
//   - the reply came from Pi inside the uservm container, as the unprivileged user
//   - no process outside the relay container has the upstream key
//   - the relay rejects callers without a token
//
// Usage:
//   PI_COFFEE_UPSTREAM_KEY=… node scripts/smoke-podman.mjs [--keep] [--no-build] [--upstream-url URL] [--model gpt-5.4-mini]
//   PI_COFFEE_UPSTREAM_KEY=… node scripts/smoke-podman.mjs --image localhost/pi-coffee-nodebase:smoke --mount-source
// Needs: podman on PATH, a running podman machine (Windows/macOS), network access to the upstream.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const keep = args.has("--keep");
const build = !args.has("--no-build");
const mountSource = args.has("--mount-source");
const upstreamUrl = argValue("--upstream-url", process.env.PI_COFFEE_UPSTREAM_URL ?? "https://b.awangsawangs.xyz/v1");
const model = argValue("--model", "gpt-5.4-mini");
const upstreamKey = process.env.PI_COFFEE_UPSTREAM_KEY ?? "";
if (upstreamKey.length === 0) {
  console.error("Set PI_COFFEE_UPSTREAM_KEY in this shell (it is passed only to the relay container).");
  process.exit(2);
}

const IMAGE = "localhost/pi-coffee:smoke";
const image = argValue("--image", IMAGE);
const NET = "pi-coffee-smoke";
const RELAY = "pi-coffee-relay";
const WEB = "pi-coffee-web";
const USERVM = "pi-coffee-uservm";
const USERVM_HOSTNAME = "uservm-smoke";
// Where the Web port is published. Default loopback; e.g. --publish 0.0.0.0:3300 to show
// the shell to someone else on the LAN.
const publish = argValue("--publish", "127.0.0.1:3300");
const WEB_PORT = Number(publish.split(":").pop());
const hostToken = randomBytes(24).toString("hex");
const relayToken = randomBytes(24).toString("hex");
// The offline base image has no WORKDIR, so always run from the source root.
// Podman forwards the host's HTTP(S)_PROXY into containers by default; a
// workstation proxy on 127.0.0.1 would then swallow every in-cluster call.
const sourceMount = [...(mountSource ? ["-v", `${root}:/opt/pi-coffee`] : []), "-w", "/opt/pi-coffee", "--http-proxy=false"];

const evidence = { startedAt: new Date().toISOString(), steps: [], ok: true };
const step = (name, ok, detail, extra = {}) => {
  evidence.steps.push({ name, ok, detail, ...extra });
  evidence.ok &&= ok;
  console.log(`[${ok ? "ok  " : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) throw new Error(name);
};

function podman(cmdArgs, opts = {}) {
  return execFileSync("podman", cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", opts.quiet ? "ignore" : "inherit"], cwd: root, ...opts }).trim();
}
function tryPodman(cmdArgs) {
  try { return podman(cmdArgs, { quiet: true }); } catch { return undefined; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(container, port, role) {
  for (let i = 0; i < 60; i++) {
    const out = tryPodman(["exec", container, "curl", "-s", `http://127.0.0.1:${port}/healthz`]);
    if (out && out.includes(`"role":"${role}"`)) return out;
    await sleep(500);
  }
  throw new Error(`${container} did not become healthy: ${tryPodman(["logs", "--tail", "20", container])}`);
}

function teardown() {
  for (const c of [WEB, USERVM, RELAY]) tryPodman(["rm", "-f", c]);
  tryPodman(["network", "rm", NET]);
}

function wsProbe(url, prompt, timeoutMs = 120_000) {
  return new Promise((resolvePromise, reject) => {
    const s = new WebSocket(url);
    const tools = [];
    let text = "";
    const timer = setTimeout(() => { s.close(); reject(new Error("probe timeout")); }, timeoutMs);
    s.on("error", reject);
    s.on("open", () => s.send(JSON.stringify({ v: 1, type: "open" })));
    s.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.type === "opened") s.send(JSON.stringify({ v: 1, type: "prompt", requestId: "podman-1", text: prompt }));
      if (f.type === "error") { clearTimeout(timer); s.close(); reject(new Error(`${f.code}: ${f.message}`)); }
      if (f.type !== "event") return;
      const e = f.event;
      if (e.type === "tool_execution_end") tools.push({ tool: e.toolName, isError: e.isError, text: (e.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("") });
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") text += e.assistantMessageEvent.delta;
      if (e.type === "agent_settled") { clearTimeout(timer); s.close(); resolvePromise({ text: text.trim(), tools }); }
    });
  });
}

try {
  podman(["--version"]);
  teardown();

  if (build) {
    console.log("building image (first run downloads node:22-bookworm-slim)…");
    podman(["build", "-q", "-t", IMAGE, "-f", "deploy/podman/Containerfile", "."]);
  }
  step("image ready", tryPodman(["image", "exists", image]) !== undefined, image);

  tryPodman(["network", "create", NET]);

  // --- server: relay (the only container that ever sees the upstream key)
  podman(["run", "-d", "--name", RELAY, "--network", NET,
    ...sourceMount,
    "-e", `PI_COFFEE_UPSTREAM_KEY=${upstreamKey}`,
    "-e", `PI_COFFEE_UPSTREAM_URL=${upstreamUrl}`,
    "-e", "PI_COFFEE_RELAY_BIND=0.0.0.0",
    "-e", `PI_COFFEE_RELAY_TOKENS=${relayToken}`,
    image, "node", "dist/src/main.js", "relay"]);

  // --- User VM: host + original Pi, as the unprivileged user, no upstream key
  podman(["run", "-d", "--name", USERVM, "--hostname", USERVM_HOSTNAME, "--network", NET, "--user", "runner",
    "--tmpfs", "/tmp:rw,mode=1777",
    ...sourceMount,
    "-e", "HOME=/tmp",
    "-e", "PI_COFFEE_HOST_BIND=0.0.0.0",
    "-e", `PI_COFFEE_HOST_TOKEN=${hostToken}`,
    "-e", `PI_COFFEE_RELAY_TOKEN=${relayToken}`,
    "-e", "PI_COFFEE_WORKDIR=/tmp/pi-coffee/work",
    "-e", "PI_COFFEE_AGENT_DIR=/tmp/pi-coffee/agent",
    "-e", "PI_COFFEE_SESSION_DIR=/tmp/pi-coffee/sessions",
    "-e", "PI_COFFEE_PROVIDER=cpa",
    "-e", `PI_COFFEE_MODEL=${model}`,
    image, "sh", "-c",
    `mkdir -p /tmp/pi-coffee/agent /tmp/pi-coffee/sessions /tmp/pi-coffee/work && sed "s#http://SERVER_IP:8789/v1#http://${RELAY}:8789/v1#" deploy/uservm/models.json.example > /tmp/pi-coffee/agent/models.json && exec node dist/src/main.js host`]);

  // --- server: web (Host token only)
  podman(["run", "-d", "--name", WEB, "--network", NET, "-p", `${publish}:3000`,
    ...sourceMount,
    "-e", "PI_COFFEE_WEB_BIND=0.0.0.0",
    "-e", `PI_COFFEE_HOST_URL=ws://${USERVM}:8788/host`,
    "-e", `PI_COFFEE_HOST_TOKEN=${hostToken}`,
    image, "node", "dist/src/main.js", "web"]);

  await waitHealthy(RELAY, 8789, "relay");
  await waitHealthy(USERVM, 8788, "host");
  await waitHealthy(WEB, 3000, "web");
  step("three containers healthy", true, `${RELAY}, ${USERVM}, ${WEB} on network ${NET}`);

  // Secret placement
  const uservmEnv = podman(["exec", USERVM, "env"]);
  const webEnv = podman(["exec", WEB, "env"]);
  const modelsJson = podman(["exec", USERVM, "cat", "/tmp/pi-coffee/agent/models.json"]);
  step("upstream key exists only in the relay container",
    !uservmEnv.includes(upstreamKey) && !webEnv.includes(upstreamKey) && !modelsJson.includes(upstreamKey) && modelsJson.includes("$PI_COFFEE_RELAY_TOKEN"),
    "uservm env, web env and models.json contain no upstream key; models.json interpolates the Relay token");

  const noToken = podman(["exec", WEB, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", `http://${RELAY}:8789/v1/models`]);
  const withToken = podman(["exec", WEB, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", `Authorization: Bearer ${relayToken}`, `http://${RELAY}:8789/v1/models`]);
  step("relay authenticates callers", noToken === "401" && withToken === "200", `no token → ${noToken}, token → ${withToken}`);

  const hostNoToken = podman(["exec", WEB, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Connection: Upgrade", "-H", "Upgrade: websocket", "-H", "Sec-WebSocket-Version: 13", "-H", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", `http://${USERVM}:8788/host`]);
  step("host refuses upgrade without token", hostNoToken === "401", `→ ${hostNoToken}`);

  // Real model through browser → web → host → Pi → relay → upstream
  const wsUrl = `ws://127.0.0.1:${WEB_PORT}/ws`;
  const smoke = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/smoke-real-model.mjs"), wsUrl], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    child.on("exit", (code) => resolvePromise({ code, out }));
  });
  step("real-model smoke through the two-machine path", smoke.code === 0, `exit ${smoke.code}`);

  const probe = await wsProbe(wsUrl, "Use your bash tool to run exactly: hostname; whoami   Then reply with the single word done.");
  const toolText = probe.tools.map((t) => t.text).join("\n");
  step("Pi executed inside the User VM container as the unprivileged user",
    toolText.includes(USERVM_HOSTNAME) && /\brunner\b/.test(toolText) && probe.tools.every((t) => !t.isError),
    `tool output: ${toolText.replace(/\s+/g, " ").trim()} | reply: ${probe.text}`);

  const relayLog = podman(["logs", "--tail", "3", RELAY]).split("\n").filter((l) => l.includes('"relay"'));
  step("relay metadata is content-free", relayLog.length > 0 && !relayLog.some((l) => l.includes("hostname") || l.includes("coffee ready")), `${relayLog.length} metadata lines, last: ${relayLog.at(-1)?.slice(0, 160)}`);

  // Failure semantics: web loses the host
  podman(["stop", "-t", "2", USERVM], { quiet: true });
  const lost = await new Promise((resolvePromise) => {
    const s = new WebSocket(wsUrl);
    const t = setTimeout(() => { s.close(); resolvePromise("timeout"); }, 15_000);
    s.on("open", () => s.send(JSON.stringify({ v: 1, type: "open" })));
    s.on("message", (raw) => { clearTimeout(t); s.close(); resolvePromise(JSON.parse(raw.toString()).code); });
    s.on("error", () => { clearTimeout(t); resolvePromise("ws-error"); });
  });
  step("browser sees host_unavailable when the User VM is down", lost === "host_unavailable", `error code: ${lost}`);
  podman(["start", USERVM], { quiet: true });
  await waitHealthy(USERVM, 8788, "host");
  step("User VM host comes back", true, "restarted and healthy");
} catch (error) {
  evidence.ok = false;
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  evidence.finishedAt = new Date().toISOString();
  console.log("\n---- evidence (contains no secrets) ----");
  console.log(JSON.stringify(evidence, null, 2));
  if (keep) {
    console.log(`\ncontainers kept; browser: http://${publish.replace("0.0.0.0", "<this-machine-ip>")}/   teardown: podman rm -f ${RELAY} ${WEB} ${USERVM}; podman network rm ${NET}`);
  } else {
    teardown();
  }
  process.exit(evidence.ok ? 0 : 1);
}
