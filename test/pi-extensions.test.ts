import { describe, expect, it } from "vitest";
import { delimiter, isAbsolute, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import {
  resolveWebExtension,
  resolveContextUsageExtension,
  resolveHarnessExtension,
  resolvePiExtensions,
  resolveContextFoldExtension,
  resolvePiLensExtension,
  resolveRpivTodoExtension,
  resolvePiMcpAdapterExtension,
  resolvePiWebAccessExtension,
  resolvePiWebAccessPackage,
} from "../src/pi-extensions.js";

describe("PI Coffee native extension selection", () => {
  it("loads the read-only context observer after the final Harness boundary", () => {
    const extensions = resolvePiExtensions({});
    expect(extensions).toEqual([
      resolvePiWebAccessExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
    expect(extensions.every((path) => isAbsolute(path))).toBe(true);
    // Local extension entries point at the build output (`dist/src`); the
    // package entry is the only source path that must exist before a build.
    expect(resolvePiWebAccessExtension()).toBe(resolvePiWebAccessPackage());
    expect(resolvePiWebAccessPackage()).toMatch(/node_modules[\\/]pi-web-access[\\/]index\.ts$/);
    expect(resolveContextFoldExtension()).toMatch(/[\\/]context[\\/]extension\.js$/);
  });

  it("does not load native subagents through legacy Coffee settings", () => {
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "off" })).toEqual([
      resolvePiWebAccessExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "false" })).toEqual([
      resolvePiWebAccessExtension(),
      resolveContextFoldExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
  });

  it("can disable context-fold independently, leaving Pi native compaction available", () => {
    expect(resolvePiExtensions({ PI_COFFEE_CONTEXT_FOLD: "off" })).toEqual([
      resolvePiWebAccessExtension(),
      resolveHarnessExtension(),
      resolveContextUsageExtension(),
    ]);
  });

  it("disables the single native Web extension with either legacy switch", () => {
    for(const key of ['PI_COFFEE_WEB','PI_COFFEE_WEB_ACCESS'])
      expect(resolvePiExtensions({[key]:'off'})).not.toContain(resolvePiWebAccessPackage());
    expect(resolvePiExtensions({}).filter(p=>p===resolvePiWebAccessPackage())).toHaveLength(1);
  });

  it("keeps pi-lens optional and explains an explicit opt-in without an installed package", () => {
    expect(resolvePiExtensions({}).some(path => path.includes("pi-lens"))).toBe(false);
    expect(() => resolvePiExtensions({
      PI_COFFEE_PI_LENS: "on", PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent",
    })).toThrow("requires a separately installed, Pi-compatible pi-lens package");
  });

  it("resolves an explicitly installed pi-lens only when opted in", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-optional-lens-"));
    const entry = join(root, "npm", "node_modules", "pi-lens", "dist", "index.js");
    try {
      await mkdir(join(root, "npm", "node_modules", "pi-lens", "dist"), { recursive: true });
      await writeFile(entry, "export default function () {}\n");
      const env = { PI_COFFEE_AGENT_DIR: root };
      expect(resolvePiExtensions(env)).not.toContain(entry);
      const enabled = resolvePiExtensions({ ...env, PI_COFFEE_PI_LENS: "on" });
      expect(resolvePiLensExtension(env)).toBe(entry);
      expect(enabled.indexOf(entry)).toBeGreaterThanOrEqual(0);
      expect(enabled.indexOf(entry)).toBeLessThan(enabled.indexOf(resolveContextFoldExtension(env)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rpiv-todo non-visible until explicitly opted in", () => {
    const defaults = resolvePiExtensions({});
    expect(defaults.some((path) => /[\\/]rpiv-todo[\\/]/.test(path))).toBe(false);

    const agentEnv = { PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" };
    const enabled = resolvePiExtensions({ ...agentEnv, PI_COFFEE_RPIV_TODO: "on" });
    const todo = resolveRpivTodoExtension(agentEnv);
    expect(enabled).toContain(todo);
    expect(enabled.indexOf(todo)).toBeLessThan(
      enabled.indexOf(resolveContextFoldExtension(agentEnv)),
    );
    expect(todo).toMatch(/node_modules[\\/]@juicesharp[\\/]rpiv-todo[\\/]index\.ts$/);
  });

  it("keeps pi-mcp-adapter non-visible until explicitly opted in", () => {
    const defaults = resolvePiExtensions({});
    expect(defaults.some((path) => /[\\/]pi-mcp-adapter[\\/]/.test(path))).toBe(false);

    const agentEnv = { PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" };
    const enabled = resolvePiExtensions({ ...agentEnv, PI_COFFEE_PI_MCP_ADAPTER: "on" });
    const adapter = resolvePiMcpAdapterExtension(agentEnv);
    expect(enabled).toContain(adapter);
    expect(enabled.indexOf(adapter)).toBeLessThan(
      enabled.indexOf(resolveContextFoldExtension(agentEnv)),
    );
    expect(adapter).toMatch(/node_modules[\\/]pi-mcp-adapter[\\/]index\.ts$/);
  });

  it("loads the pinned context-fold entry through Pi's native loader", async () => {
    const result = await discoverAndLoadExtensions(
      [resolveContextFoldExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" })],
      process.cwd(),
      "/tmp/pi-coffee-no-agent",
    );
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
  });

  it("keeps an explicit extension replacement list authoritative", () => {
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: ` ./one.js${delimiter}/two.js${delimiter} ` })).toEqual([
      "./one.js",
      "/two.js",
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: "off", PI_COFFEE_SUBAGENTS: "on" })).toEqual([]);
  });

});
