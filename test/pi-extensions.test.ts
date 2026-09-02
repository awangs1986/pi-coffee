import { describe, expect, it } from "vitest";
import {
  resolveHarnessExtension,
  resolvePiExtensions,
  resolvePiSubagentsExtension,
  resolvePiSubagentsResourceExtension,
} from "../src/pi-extensions.js";
import subagentsResourceExtension from "../src/subagents/extension.js";

describe("PI Coffee native extension selection", () => {
  it("loads Harness, the pinned pi-subagents entry, and its resource adapter by default", () => {
    const extensions = resolvePiExtensions({});
    expect(extensions).toEqual([
      resolveHarnessExtension(),
      resolvePiSubagentsExtension(),
      resolvePiSubagentsResourceExtension(),
    ]);
    expect(extensions.every((path) => path.startsWith("/"))).toBe(true);
    // Local extension entries point at the build output (`dist/src`); the
    // package entry is the only source path that must exist before a build.
    expect(resolvePiSubagentsExtension()).toMatch(/node_modules[\\/]pi-subagents[\\/]index\.ts$/);
  });

  it("can disable only pi-subagents while retaining Harness", () => {
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "off" })).toEqual([resolveHarnessExtension()]);
    expect(resolvePiExtensions({ PI_COFFEE_SUBAGENTS: "false" })).toEqual([resolveHarnessExtension()]);
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
