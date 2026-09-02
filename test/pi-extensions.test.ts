import { describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import {
  resolveHarnessExtension,
  resolvePiExtensions,
  resolveContextFoldExtension,
  resolvePiLensExtension,
  resolveRpivTodoExtension,
  resolvePiSubagentsExtension,
  resolvePiSubagentsResourceExtension,
} from "../src/pi-extensions.js";
import subagentsResourceExtension from "../src/subagents/extension.js";

describe("PI Coffee native extension selection", () => {
  it("loads context-fold last so deterministic compaction replaces Pi's native summary", () => {
    const extensions = resolvePiExtensions({});
    expect(extensions).toEqual([
      resolveHarnessExtension(),
      resolvePiSubagentsExtension(),
      resolvePiSubagentsResourceExtension(),
      resolveContextFoldExtension(),
    ]);
    expect(extensions.every((path) => path.startsWith("/"))).toBe(true);
    // Local extension entries point at the build output (`dist/src`); the
    // package entry is the only source path that must exist before a build.
    expect(resolvePiSubagentsExtension()).toMatch(/node_modules[\\/]pi-subagents[\\/]index\.ts$/);
    expect(resolveContextFoldExtension()).toMatch(/node_modules[\\/]context-fold[\\/]index\.ts$/);
  });

  it("can disable only pi-subagents while retaining Harness", () => {
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "off" })).toEqual([
      resolveHarnessExtension(),
      resolveContextFoldExtension(),
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "false" })).toEqual([
      resolveHarnessExtension(),
      resolveContextFoldExtension(),
    ]);
  });

  it("can disable context-fold independently, leaving Pi native compaction available", () => {
    expect(resolvePiExtensions({ PI_COFFEE_CONTEXT_FOLD: "off" })).toEqual([
      resolveHarnessExtension(),
      resolvePiSubagentsExtension(),
      resolvePiSubagentsResourceExtension(),
    ]);
  });

  it("keeps pi-lens non-visible until explicitly opted in", () => {
    const defaults = resolvePiExtensions({});
    expect(defaults.some((path) => /[\\/]pi-lens[\\/]/.test(path))).toBe(false);

    const enabled = resolvePiExtensions({
      PI_COFFEE_PI_LENS: "on",
      PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent",
    });
    expect(enabled).toContain(resolvePiLensExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" }));
    expect(enabled.indexOf(resolvePiLensExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" })))
      .toBeLessThan(enabled.indexOf(resolveContextFoldExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" })));
    expect(resolvePiLensExtension({ PI_COFFEE_AGENT_DIR: "/tmp/pi-coffee-no-agent" })).toMatch(/node_modules[\\/]pi-lens[\\/](dist[\\/]index\.js|index\.js)$/);
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
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: " ./one.js:/two.js: " })).toEqual([
      "./one.js",
      "/two.js",
    ]);
    expect(resolvePiExtensions({ PI_COFFEE_EXTENSIONS: "off", PI_COFFEE_SUBAGENTS: "on" })).toEqual([]);
  });

  it("exposes upstream skills and prompt templates through Pi resource discovery", () => {
    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    const fakePi = {
      on(event: string, handler: (payload: unknown, context: unknown) => unknown) {
        handlers.set(event, handler);
      },
    };
    subagentsResourceExtension(fakePi as never);
    const result = handlers.get("resources_discover")?.({ type: "resources_discover", cwd: "/tmp", reason: "startup" }, {});
    expect(result).toEqual({
      skillPaths: [expect.stringMatching(/node_modules[\\/]pi-subagents[\\/]skills$/)],
      promptPaths: [expect.stringMatching(/node_modules[\\/]pi-subagents[\\/]prompts$/)],
    });
  });
});
