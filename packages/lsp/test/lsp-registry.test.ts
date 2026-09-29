import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findProjectRoot, runCoffeeLsp } from "../src/lsp/cli.js";
import {
  candidateServers,
  listServers,
  resolveProfile,
  toServerSpec,
  typeScriptFlavour,
} from "../src/lsp/profiles.js";
import {
  BUILTIN_SERVERS,
  hasRootMarkers,
  languageIdFor,
  loadServerRegistry,
  resolveExecutable,
} from "../src/lsp/registry.js";

const fakeServer = resolve("test/fixtures/fake-lsp-server.mjs");
const fakeArgv = JSON.stringify([process.execPath, fakeServer]);

function scratch(prefix: string): {
  root: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "agent"));
  mkdirSync(join(root, "home"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_COFFEE_LSP_HOME: join(root, "home"),
    // Keep host overrides from leaking into registry expectations.
    PATH: process.env.PATH,
  };
  for (const key of Object.keys(env))
    if (/^PI_COFFEE_.*_LSP_COMMAND$/.test(key)) delete env[key];
  return {
    root,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("language-server registry", () => {
  it("maps file names to LSP language ids", () => {
    expect(languageIdFor("/p/App.vue")).toBe("vue");
    expect(languageIdFor("/p/x.tsx")).toBe("typescriptreact");
    expect(languageIdFor("/p/Dockerfile")).toBe("dockerfile");
    expect(languageIdFor("/p/CMakeLists.txt")).toBe("cmake");
    expect(languageIdFor("/p/main.h")).toBe("c");
    expect(languageIdFor("/p/notes.unknown")).toBe("plaintext");
    expect(languageIdFor("/p/anything.cs", "csharp")).toBe("csharp");
  });

  it("ships the web, game and application servers as built-ins", () => {
    for (const id of [
      "typescript",
      "html",
      "css",
      "json",
      "yaml",
      "vue",
      "svelte",
      "astro",
      "tailwindcss",
      "eslint",
      "python",
      "cpp",
      "rust",
      "go",
      "csharp",
      "omnisharp",
      "lua",
      "glsl",
      "zig",
      "java",
      "kotlin",
      "dart",
      "swift",
      "bash",
      "dockerfile",
    ])
      expect(BUILTIN_SERVERS[id], id).toBeDefined();
    for (const [id, definition] of Object.entries(BUILTIN_SERVERS)) {
      expect(definition.fileTypes.length, id).toBeGreaterThan(0);
      expect(definition.rootMarkers.length, id).toBeGreaterThan(0);
      expect(definition.language, id).toBeTruthy();
    }
  });

  it("matches root markers by name or one-level glob", () => {
    const { root, cleanup } = scratch("coffee-lsp-markers-");
    try {
      writeFileSync(join(root, "Game.sln"), "");
      expect(hasRootMarkers(root, ["*.sln"])).toBe(true);
      expect(hasRootMarkers(root, ["*.csproj"])).toBe(false);
      expect(hasRootMarkers(root, ["Game.sln"])).toBe(true);
      expect(hasRootMarkers(join(root, "missing"), ["*.sln"])).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("merges coffee-lsp.json server sections over the built-ins and ignores broken entries", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-registry-");
    try {
      writeFileSync(
        join(root, "agent", "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            python: { disabled: true },
            gdscript: {
              command: "/usr/bin/false",
              fileTypes: [".gd"],
              rootMarkers: ["project.godot"],
            },
            broken: { command: "x" },
          },
        }),
      );
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            python: { disabled: false, settings: { python: { flag: 1 } } },
            vue: { initOptions: { typescript: { tsdk: "/custom" } } },
          },
        }),
      );
      const registry = loadServerRegistry({
        configDirectories: [join(root, "agent"), root],
      });
      expect(registry.python.disabled).toBe(false);
      expect(registry.python.settings).toMatchObject({ python: { flag: 1 } });
      // A command configured for the built-in TCP entry becomes a stdio bridge.
      expect(registry.gdscript).toMatchObject({
        command: "/usr/bin/false",
        fileTypes: [".gd"],
      });
      expect(registry.gdscript.transport).toBeUndefined();
      expect(BUILTIN_SERVERS.gdscript).toMatchObject({
        transport: "tcp",
        port: 6005,
        command: "tcp://127.0.0.1:6005",
      });
      expect(registry.broken).toBeUndefined();
      expect(registry.vue.initializationOptions).toEqual({
        typescript: { tsdk: "/custom" },
      });
      // Malformed JSON never breaks resolution.
      writeFileSync(join(root, "coffee-lsp.json"), "{ not json");
      expect(
        loadServerRegistry({ configDirectories: [join(root, "agent"), root] })
          .python.disabled,
      ).toBe(true);
      expect(resolveProfile(join(root, "a.py"), root, env).available).toBe(
        false,
      );
    } finally {
      cleanup();
    }
  });

  it("explains how to install a missing built-in server", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-missing-");
    try {
      env.PATH = root; // nothing installed
      const vue = resolveProfile(join(root, "App.vue"), root, env);
      expect(vue).toMatchObject({
        id: "vue",
        available: false,
        role: "language",
      });
      expect(vue.reason).toContain("@vue/language-server");
      expect(vue.reason).toContain("PI_COFFEE_VUE_LSP_COMMAND");
      expect(resolveProfile(join(root, "Dockerfile"), root, env).id).toBe(
        "dockerfile",
      );
      expect(resolveProfile(join(root, "notes.txt"), root, env)).toMatchObject({
        id: "unknown",
        available: false,
      });
      // Bundled servers stay available without PATH.
      expect(resolveProfile(join(root, "a.py"), root, env)).toMatchObject({
        id: "python",
        available: true,
        source: "bundled",
      });
      expect(resolveProfile(join(root, "a.ts"), root, env)).toMatchObject({
        id: "typescript",
        available: true,
        source: "bundled",
      });
    } finally {
      cleanup();
    }
  });

  it("prefers project-local, then managed, then PATH executables", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-resolve-");
    try {
      const write = (path: string) => {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "#!/bin/sh\n");
        chmodSync(path, 0o755);
      };
      const project = join(root, "repo", "packages", "web");
      mkdirSync(project, { recursive: true });
      const onPath = join(root, "bin", "vue-language-server");
      const managed = join(
        root,
        "home",
        "npm",
        "node_modules",
        ".bin",
        "vue-language-server",
      );
      const local = join(
        root,
        "repo",
        "node_modules",
        ".bin",
        "vue-language-server",
      );
      write(onPath);
      env.PATH = join(root, "bin");
      expect(resolveExecutable("vue-language-server", project, env)).toEqual({
        command: onPath,
        source: "path",
      });
      write(managed);
      expect(resolveExecutable("vue-language-server", project, env)).toEqual({
        command: managed,
        source: "managed",
      });
      write(local);
      expect(resolveExecutable("vue-language-server", project, env)).toEqual({
        command: local,
        source: "project",
      });
      expect(resolveExecutable("nope-language-server", project, env)).toBe(
        undefined,
      );
      expect(
        resolveProfile(join(project, "App.vue"), project, env),
      ).toMatchObject({
        id: "vue",
        available: true,
        command: local,
        source: "project",
      });
    } finally {
      cleanup();
    }
  });

  it("ranks language servers over linters, then by root markers", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-rank-");
    try {
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            alpha: {
              command: process.execPath,
              args: [fakeServer],
              fileTypes: [".foo"],
              rootMarkers: ["alpha.marker"],
            },
            beta: {
              command: process.execPath,
              args: [fakeServer],
              fileTypes: [".foo"],
              rootMarkers: ["beta.marker"],
            },
            "foo-lint": {
              command: process.execPath,
              args: [fakeServer],
              fileTypes: [".foo"],
              rootMarkers: ["alpha.marker", "beta.marker"],
              isLinter: true,
            },
          },
        }),
      );
      const file = join(root, "main.foo");
      writeFileSync(file, "");
      expect(
        candidateServers(
          file,
          loadServerRegistry({ configDirectories: [root] }),
        ).map(([id]) => id),
      ).toEqual(["alpha", "beta", "foo-lint"]);
      expect(resolveProfile(file, root, env).id).toBe("alpha");
      writeFileSync(join(root, "beta.marker"), "");
      expect(resolveProfile(file, root, env).id).toBe("beta");
      // A linter is used only when no language server is available for the file.
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            "foo-lint": {
              command: process.execPath,
              args: [fakeServer],
              fileTypes: [".foo"],
              rootMarkers: ["beta.marker"],
              isLinter: true,
            },
            gamma: {
              command: "definitely-not-installed-server",
              fileTypes: [".foo"],
              rootMarkers: ["beta.marker"],
            },
          },
        }),
      );
      expect(resolveProfile(file, root, env)).toMatchObject({
        id: "foo-lint",
        role: "linter",
        available: true,
      });
    } finally {
      cleanup();
    }
  });

  it("locates project roots with the markers of the servers covering the file", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-roots-");
    try {
      const app = join(root, "apps", "site");
      mkdirSync(join(app, "src", "components"), { recursive: true });
      writeFileSync(join(root, "package.json"), "{}");
      writeFileSync(join(app, "vite.config.ts"), "");
      const vue = join(app, "src", "components", "Hello.vue");
      writeFileSync(vue, "<template/>");
      expect(findProjectRoot(vue, root, true, env)).toBe(app);
      const shader = join(app, "src", "glow.frag");
      writeFileSync(shader, "");
      // GLSL markers are .git/shaders style; nothing matches, so the workspace is used.
      expect(findProjectRoot(shader, root, true, env)).toBe(root);
      const docker = join(app, "Dockerfile");
      writeFileSync(docker, "FROM scratch\n");
      expect(findProjectRoot(docker, root, true, env)).toBe(app);
    } finally {
      cleanup();
    }
  });

  it("runs a config-defined server end to end with its language id and settings", async () => {
    const { root, env, cleanup } = scratch("coffee-lsp-config-server-");
    try {
      const languageIds = join(root, "language-ids");
      writeFileSync(join(root, "package.json"), "{}");
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            vue: {
              command: process.execPath,
              args: [fakeServer],
              settings: { fixture: { target: "from-registry" } },
            },
          },
        }),
      );
      const file = join(root, "App.vue");
      writeFileSync(file, "const target = 1;\nconst value = BAD;\n");
      const runEnv = {
        ...env,
        PI_COFFEE_FAKE_LSP_LANGUAGE_ID: languageIds,
        PI_COFFEE_FAKE_LSP_SETTINGS: "1",
      };
      const status = await invoke(
        ["status", "--file", file, "--workspace", root],
        root,
        runEnv,
      );
      expect(status.json.server).toMatchObject({
        id: "vue",
        state: "available",
        source: "project",
        language: "Vue",
      });
      const diagnostics = await invoke(
        ["diagnostics", "--file", file, "--workspace", root, "--no-daemon"],
        root,
        runEnv,
      );
      expect(diagnostics.json.diagnosticState).toBe("findings");
      expect(diagnostics.json.items[0].message).toBe("BAD is not assignable");
      expect(readFileSync(languageIds, "utf8").trim()).toBe("vue");
      const hover = await invoke(
        [
          "hover",
          "--file",
          file,
          "--workspace",
          root,
          "--line",
          "1",
          "--column",
          "7",
          "--no-daemon",
        ],
        root,
        runEnv,
      );
      expect(hover.json.items[0].text).toBe("from-registry");
      // Legacy per-profile sections still win over registry defaults.
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            vue: {
              command: process.execPath,
              args: [fakeServer],
              settings: { fixture: { target: "from-registry" } },
            },
          },
          vue: { settings: { fixture: { target: "legacy" } } },
        }),
      );
      const profile = resolveProfile(file, root, env);
      expect(toServerSpec(profile, root, env)).toMatchObject({
        id: "vue",
        languageId: undefined,
        settings: { fixture: { target: "legacy" } },
      });
    } finally {
      cleanup();
    }
  });

  it("accepts a generic environment override for any registry entry", async () => {
    const { root, env, cleanup } = scratch("coffee-lsp-generic-override-");
    try {
      const file = join(root, "main.lua");
      writeFileSync(file, "local target = 1\n");
      env.PATH = root;
      expect(resolveProfile(file, root, env).available).toBe(false);
      const overridden = resolveProfile(file, root, {
        ...env,
        PI_COFFEE_LUA_LSP_COMMAND: fakeArgv,
      });
      expect(overridden).toMatchObject({
        id: "lua",
        available: true,
        source: "override",
        command: process.execPath,
      });
      const result = await invoke(
        ["symbols", "--file", file, "--workspace", root, "--no-daemon"],
        root,
        { ...env, PI_COFFEE_LUA_LSP_COMMAND: fakeArgv },
      );
      expect(result.code).toBe(0);
      expect(result.json.items[0]).toMatchObject({ name: "target" });
    } finally {
      cleanup();
    }
  });

  it("substitutes ${pid} and ${tsdk} tokens and drops unknown ones", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-tokens-");
    try {
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            omni: {
              command: process.execPath,
              args: ["--hostPID", "${pid}", "-lsp"],
              fileTypes: [".cs"],
              rootMarkers: ["*.sln"],
              initOptions: { typescript: { tsdk: "${tsdk}" }, keep: true },
              languageId: "csharp",
            },
          },
        }),
      );
      const profile = resolveProfile(join(root, "A.cs"), root, env);
      expect(profile.id).toBe("omni");
      const spec = toServerSpec(profile, root, env);
      expect(spec.args).toEqual(["--hostPID", String(process.pid), "-lsp"]);
      expect(spec.initializationOptions).toEqual({
        typescript: {},
        keep: true,
      });
      expect(spec.languageId).toBe("csharp");
      mkdirSync(join(root, "node_modules", "typescript", "lib"), {
        recursive: true,
      });
      writeFileSync(
        join(root, "node_modules", "typescript", "package.json"),
        JSON.stringify({ name: "typescript", version: "5.9.3" }),
      );
      for (const name of ["typescript.js", "tsserver.js"])
        writeFileSync(
          join(root, "node_modules", "typescript", "lib", name),
          "",
        );
      expect(
        (toServerSpec(profile, root, env).initializationOptions as any)
          .typescript.tsdk,
      ).toBe(join(root, "node_modules", "typescript", "lib"));
    } finally {
      cleanup();
    }
  });

  it("selects the TypeScript flavour from the project's own installation", () => {
    const { root, env, cleanup } = scratch("coffee-lsp-ts-flavour-");
    try {
      const file = join(root, "app.ts");
      writeFileSync(file, "");
      writeFileSync(join(root, "tsconfig.json"), "{}");
      // No project TypeScript: typescript-language-server (its bundled or managed TS 5).
      expect(typeScriptFlavour(root, env)).toBe("typescript");
      expect(resolveProfile(file, root, env).id).toBe("typescript");
      // TypeScript 7 (native): no lib/tsserver.js, tsc --lsp.
      const pkg = join(root, "node_modules", "typescript");
      mkdirSync(join(pkg, "lib"), { recursive: true });
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ name: "typescript", version: "7.0.2" }),
      );
      writeFileSync(join(pkg, "lib", "tsc.js"), "");
      const bin = join(root, "node_modules", ".bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "tsc"), "#!/bin/sh\n");
      chmodSync(join(bin, "tsc"), 0o755);
      expect(typeScriptFlavour(root, env)).toBe("typescript-native");
      expect(resolveProfile(file, root, env)).toMatchObject({
        id: "typescript-native",
        available: true,
        command: join(bin, "tsc"),
        args: ["--lsp", "--stdio"],
      });
      const listing = listServers(root, env);
      expect(listing.find((entry) => entry.id === "typescript")).toMatchObject({
        status: "missing",
        note: expect.stringContaining("native TypeScript 7"),
      });
      // TypeScript 5: tsserver.js present → typescript-language-server again.
      writeFileSync(join(pkg, "lib", "tsserver.js"), "");
      writeFileSync(join(pkg, "lib", "typescript.js"), "");
      expect(typeScriptFlavour(root, env)).toBe("typescript");
      expect(resolveProfile(file, root, env).id).toBe("typescript");
    } finally {
      cleanup();
    }
  });

  it("lists the registry with install hints and applies-to-file flags", async () => {
    const { root, env, cleanup } = scratch("coffee-lsp-servers-");
    try {
      env.PATH = root;
      writeFileSync(
        join(root, "coffee-lsp.json"),
        JSON.stringify({
          servers: {
            haxe: {
              command: process.execPath,
              args: [fakeServer],
              fileTypes: [".hx"],
              rootMarkers: ["build.hxml"],
            },
          },
        }),
      );
      const listing = listServers(root, env);
      expect(listing.find((entry) => entry.id === "typescript")).toMatchObject({
        status: "available",
        source: "bundled",
      });
      expect(listing.find((entry) => entry.id === "yaml")).toMatchObject({
        status: "missing",
        install: expect.stringContaining("coffee-lsp install yaml"),
      });
      expect(listing.find((entry) => entry.id === "haxe")).toMatchObject({
        status: "available",
        configured: true,
      });
      expect(listing.find((entry) => entry.id === "gdscript")).toMatchObject({
        status: "available",
        source: "tcp",
        command: "tcp://127.0.0.1:6005",
        note: expect.stringContaining("not probed"),
      });
      expect(listing.find((entry) => entry.id === "markdown")?.status).toBe(
        "disabled",
      );
      const file = join(root, "Player.hx");
      writeFileSync(file, "");
      const result = await invoke(
        ["servers", "--file", file, "--workspace", root],
        root,
        env,
      );
      expect(result.code).toBe(0);
      expect(result.json).toMatchObject({
        operation: "servers",
        status: "ok",
        managedPrefix: join(root, "home", "npm"),
      });
      expect(result.json.issues).toEqual([]);
      const items: any[] = result.json.items;
      expect(items.length).toBe(Object.keys(BUILTIN_SERVERS).length + 1);
      expect(
        items.filter((item) => item.appliesToFile).map((item) => item.id),
      ).toEqual(["haxe"]);
      const install = await invoke(["install", "nope"], root, env);
      expect(install).toMatchObject({
        code: 2,
        json: { issues: [{ code: "invalid_arguments" }] },
      });
      const manual = await invoke(["install", "rust"], root, env);
      expect(manual).toMatchObject({
        code: 3,
        json: { issues: [{ code: "manual_install_required" }] },
      });
      expect(manual.json.issues[0].message).toContain("rustup");
    } finally {
      cleanup();
    }
  });
});

async function invoke(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; json: any }> {
  let stdout = "";
  let stderr = "";
  const code = await runCoffeeLsp(args, {
    cwd,
    env,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  expect(stderr).toBe("");
  return { code, json: JSON.parse(stdout) };
}
