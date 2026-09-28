import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";

/**
 * Language-server registry.
 *
 * Built-in entries are adapted from oh-my-pi's `lsp/defaults.json` (MIT, see
 * third_party/oh-my-pi): command lines, file types, root markers and the
 * settings that matter for read-only diagnostics and navigation. Entries are
 * ordered by preference; one server serves a file — language servers before
 * linters, then entries whose markers exist at the project root, then registry
 * order — and the first one that resolves to an executable wins (see
 * profiles.ts). `coffee-lsp.json` files add, override or disable entries under
 * a top-level `servers` key.
 */
export interface ServerDefinition {
  /** Executable name, absolute path, or `node:<module entry>` for a bundled npm server. */
  command: string;
  args?: string[];
  /** Extensions with a leading dot (`.vue`) or exact file names (`Dockerfile`). */
  fileTypes: string[];
  /** Files or `*.ext` patterns that mark a project root, checked one level per directory. */
  rootMarkers: string[];
  /**
   * Subset of markers that must exist at the chosen root before semantic
   * results are trusted; otherwise the CLI reports `project_configuration_missing`.
   */
  requiredMarkers?: string[];
  /** Overrides the language id derived from the file extension. */
  languageId?: string;
  settings?: Record<string, unknown>;
  initializationOptions?: Record<string, unknown>;
  /** Linters and formatters report diagnostics but are not a source of type information. */
  isLinter?: boolean;
  /** Accept diagnostics published without a document version (rust-analyzer). */
  allowVersionlessDiagnostics?: boolean;
  /** How to obtain the executable when it is missing. */
  install?: string;
  /** npm package that provides `command`; enables `coffee-lsp install <id>`. */
  npm?: string;
  disabled?: boolean;
  /** Human-readable language family for listings. */
  language: string;
}

export type ServerRegistry = Record<string, ServerDefinition>;

export const BUNDLED_TYPESCRIPT = "node:typescript-language-server/lib/cli.mjs";
export const BUNDLED_PYRIGHT = "node:pyright/langserver.index.js";

const TS_FILES = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const PYTHON_MARKERS = [
  "pyrightconfig.json",
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
  "requirements.txt",
  "Pipfile",
];
const JVM_MARKERS = [
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pom.xml",
];

export const BUILTIN_SERVERS: ServerRegistry = {
  // --- Web -----------------------------------------------------------------
  typescript: {
    language: "TypeScript / JavaScript",
    command: BUNDLED_TYPESCRIPT,
    args: ["--stdio"],
    fileTypes: TS_FILES,
    rootMarkers: ["tsconfig.json", "jsconfig.json"],
    // The project's own typescript is used; a managed copy serves projects
    // without one (plain JavaScript, scripts) after `coffee-lsp install typescript`.
    initializationOptions: {
      hostInfo: "pi-coffee-lsp",
      tsserver: { fallbackPath: "${managedTsdk}" },
    },
    npm: "typescript@5",
    install:
      "bundled; projects without node_modules/typescript need coffee-lsp install typescript (managed TypeScript 5 fallback) or coffee-lsp install typescript-native",
  },
  "typescript-native": {
    language: "TypeScript 7 (native tsc --lsp)",
    command: "tsc",
    args: ["--lsp", "--stdio"],
    fileTypes: TS_FILES,
    rootMarkers: ["tsconfig.json", "jsconfig.json"],
    npm: "typescript",
    install:
      "selected automatically when the project's typescript is 7+ (native); projects without typescript can use coffee-lsp install typescript-native (managed TypeScript 7)",
  },
  deno: {
    language: "Deno",
    command: "deno",
    args: ["lsp"],
    fileTypes: [".ts", ".tsx", ".js", ".jsx"],
    rootMarkers: ["deno.json", "deno.jsonc", "deno.lock"],
    requiredMarkers: ["deno.json", "deno.jsonc", "deno.lock"],
    initializationOptions: { enable: true, lint: true, unstable: true },
    install: "https://deno.com (deno on PATH)",
  },
  html: {
    language: "HTML",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    fileTypes: [".html", ".htm"],
    rootMarkers: ["package.json", ".git"],
    initializationOptions: { provideFormatter: false },
    // The HTML server validates embedded <style>/<script> only; VS Code sends
    // these defaults and the server treats a missing section as "off".
    settings: {
      html: {
        validate: { scripts: true, styles: true },
        format: { enable: false },
      },
      css: { validate: true },
      javascript: { validate: { enable: true } },
    },
    npm: "vscode-langservers-extracted",
    install: "coffee-lsp install html (npm: vscode-langservers-extracted)",
  },
  css: {
    language: "CSS / SCSS / Less",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    fileTypes: [".css", ".scss", ".sass", ".less"],
    rootMarkers: ["package.json", ".git"],
    initializationOptions: { provideFormatter: false },
    // Sections are requested through workspace/configuration; a null section
    // crashes the linter, so each language gets an explicit object.
    settings: {
      css: { validate: true, lint: {} },
      scss: { validate: true, lint: {} },
      less: { validate: true, lint: {} },
    },
    npm: "vscode-langservers-extracted",
    install: "coffee-lsp install css (npm: vscode-langservers-extracted)",
  },
  json: {
    language: "JSON",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    fileTypes: [".json", ".jsonc"],
    rootMarkers: ["package.json", ".git"],
    initializationOptions: { provideFormatter: false },
    // validate.enable defaults to false inside the server; VS Code always sends true.
    settings: {
      json: {
        validate: { enable: true },
        format: { enable: false },
        schemas: [],
        schemaDownload: { enable: true },
      },
    },
    npm: "vscode-langservers-extracted",
    install: "coffee-lsp install json (npm: vscode-langservers-extracted)",
  },
  vue: {
    language: "Vue",
    command: "vue-language-server",
    args: ["--stdio"],
    fileTypes: [".vue"],
    rootMarkers: [
      "vue.config.js",
      "nuxt.config.js",
      "nuxt.config.ts",
      "vite.config.ts",
      "vite.config.js",
      "package.json",
    ],
    initializationOptions: { typescript: { tsdk: "${tsdk}" } },
    npm: "@vue/language-server",
    install:
      "npm install --save-dev @vue/language-server (or coffee-lsp install vue)",
  },
  svelte: {
    language: "Svelte",
    command: "svelteserver",
    args: ["--stdio"],
    fileTypes: [".svelte"],
    rootMarkers: [
      "svelte.config.js",
      "svelte.config.mjs",
      "svelte.config.ts",
      "package.json",
    ],
    npm: "svelte-language-server",
    install:
      "npm install --save-dev svelte-language-server (or coffee-lsp install svelte)",
  },
  astro: {
    language: "Astro",
    command: "astro-ls",
    args: ["--stdio"],
    fileTypes: [".astro"],
    rootMarkers: [
      "astro.config.mjs",
      "astro.config.js",
      "astro.config.ts",
      "package.json",
    ],
    initializationOptions: { typescript: { tsdk: "${tsdk}" } },
    npm: "@astrojs/language-server",
    install:
      "npm install --save-dev @astrojs/language-server (or coffee-lsp install astro)",
  },
  tailwindcss: {
    language: "Tailwind CSS",
    command: "tailwindcss-language-server",
    args: ["--stdio"],
    fileTypes: [
      ".html",
      ".css",
      ".scss",
      ".vue",
      ".svelte",
      ".astro",
      ".jsx",
      ".tsx",
    ],
    rootMarkers: [
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.mjs",
      "tailwind.config.cjs",
    ],
    requiredMarkers: [
      "tailwind.config.js",
      "tailwind.config.ts",
      "tailwind.config.mjs",
      "tailwind.config.cjs",
    ],
    isLinter: true,
    npm: "@tailwindcss/language-server",
    install:
      "coffee-lsp install tailwindcss (npm: @tailwindcss/language-server)",
  },
  eslint: {
    language: "ESLint",
    command: "vscode-eslint-language-server",
    args: ["--stdio"],
    fileTypes: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".vue",
      ".svelte",
    ],
    rootMarkers: [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yml",
    ],
    isLinter: true,
    // The ESLint server asks for the whole settings object (section "") per
    // document, like VS Code's client provides. Mirrors nvim-lspconfig's block.
    settings: {
      validate: "on",
      packageManager: "npm",
      useESLintClass: false,
      useFlatConfig: true,
      experimental: { useFlatConfig: false },
      codeActionOnSave: { enable: false, mode: "all" },
      format: false,
      quiet: false,
      onIgnoredFiles: "off",
      options: {},
      rulesCustomizations: [],
      run: "onSave",
      problems: { shortenToSingleLine: false },
      nodePath: "",
      workingDirectory: { mode: "location" },
      workspaceFolder: { uri: "${rootUri}", name: "${rootName}" },
      codeAction: {
        disableRuleComment: { enable: true, location: "separateLine" },
        showDocumentation: { enable: true },
      },
    },
    npm: "vscode-langservers-extracted",
    install: "coffee-lsp install eslint (npm: vscode-langservers-extracted)",
  },
  biome: {
    language: "Biome",
    command: "biome",
    args: ["lsp-proxy"],
    fileTypes: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
      ".jsonc",
      ".css",
    ],
    rootMarkers: ["biome.json", "biome.jsonc"],
    requiredMarkers: ["biome.json", "biome.jsonc"],
    isLinter: true,
    npm: "@biomejs/biome",
    install: "npm install --save-dev @biomejs/biome",
  },
  graphql: {
    language: "GraphQL",
    command: "graphql-lsp",
    args: ["server", "-m", "stream"],
    fileTypes: [".graphql", ".gql"],
    rootMarkers: [
      ".graphqlrc",
      ".graphqlrc.json",
      ".graphqlrc.yml",
      ".graphqlrc.yaml",
      "graphql.config.js",
      "graphql.config.ts",
    ],
    npm: "graphql-language-service-cli",
    install: "coffee-lsp install graphql (npm: graphql-language-service-cli)",
  },
  prisma: {
    language: "Prisma",
    command: "prisma-language-server",
    args: ["--stdio"],
    fileTypes: [".prisma"],
    rootMarkers: ["schema.prisma", "prisma/schema.prisma", "package.json"],
    npm: "@prisma/language-server",
    install: "coffee-lsp install prisma (npm: @prisma/language-server)",
  },
  php: {
    language: "PHP",
    command: "intelephense",
    args: ["--stdio"],
    fileTypes: [".php", ".phtml"],
    rootMarkers: ["composer.json", "composer.lock", ".git"],
    npm: "intelephense",
    install: "coffee-lsp install php (npm: intelephense)",
  },

  // --- Python ----------------------------------------------------------------
  python: {
    language: "Python (Pyright)",
    command: BUNDLED_PYRIGHT,
    args: ["--stdio"],
    fileTypes: [".py", ".pyi"],
    rootMarkers: PYTHON_MARKERS,
    install: "bundled",
  },
  basedpyright: {
    language: "Python (basedpyright)",
    command: "basedpyright-langserver",
    args: ["--stdio"],
    fileTypes: [".py", ".pyi"],
    rootMarkers: PYTHON_MARKERS,
    install: "pip install basedpyright",
    disabled: true,
  },
  ruff: {
    language: "Python (Ruff lint)",
    command: "ruff",
    args: ["server"],
    fileTypes: [".py", ".pyi"],
    rootMarkers: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
    isLinter: true,
    install: "pip install ruff",
  },

  // --- Systems / games -------------------------------------------------------
  cpp: {
    language: "C / C++ / CUDA / Objective-C",
    command: "clangd",
    args: ["--background-index"],
    fileTypes: [
      ".c",
      ".h",
      ".cc",
      ".cpp",
      ".cxx",
      ".hpp",
      ".hh",
      ".hxx",
      ".cu",
      ".cuh",
      ".m",
      ".mm",
    ],
    rootMarkers: [
      "compile_commands.json",
      "build/compile_commands.json",
      ".clangd",
      "CMakeLists.txt",
    ],
    requiredMarkers: [
      "compile_commands.json",
      "build/compile_commands.json",
      ".clangd",
    ],
    install: "https://clangd.llvm.org/installation (apt/brew install clangd)",
  },
  rust: {
    language: "Rust",
    command: "rust-analyzer",
    args: [],
    fileTypes: [".rs"],
    rootMarkers: ["Cargo.toml", "rust-project.json"],
    requiredMarkers: ["Cargo.toml", "rust-project.json"],
    allowVersionlessDiagnostics: true,
    install: "rustup component add rust-analyzer",
  },
  go: {
    language: "Go",
    command: "gopls",
    args: ["serve"],
    fileTypes: [".go"],
    rootMarkers: ["go.work", "go.mod"],
    requiredMarkers: ["go.mod", "go.work"],
    install: "go install golang.org/x/tools/gopls@latest",
  },
  csharp: {
    language: "C# (csharp-ls)",
    command: "csharp-ls",
    args: [],
    fileTypes: [".cs"],
    rootMarkers: ["*.sln", "*.slnx", "*.csproj"],
    languageId: "csharp",
    install: "dotnet tool install --global csharp-ls",
  },
  omnisharp: {
    language: "C# (OmniSharp, Unity)",
    command: "omnisharp",
    args: [
      "-z",
      "--hostPID",
      "${pid}",
      "--encoding",
      "utf-8",
      "--languageserver",
    ],
    fileTypes: [".cs", ".csx"],
    rootMarkers: ["*.sln", "*.slnx", "*.csproj", "omnisharp.json"],
    languageId: "csharp",
    install:
      "https://github.com/OmniSharp/omnisharp-roslyn/releases (omnisharp on PATH)",
  },
  zig: {
    language: "Zig",
    command: "zls",
    args: [],
    fileTypes: [".zig", ".zon"],
    rootMarkers: ["build.zig", "build.zig.zon", "zls.json"],
    install: "https://github.com/zigtools/zls/releases",
  },
  odin: {
    language: "Odin",
    command: "ols",
    args: [],
    fileTypes: [".odin"],
    rootMarkers: ["ols.json", ".git"],
    install: "https://github.com/DanielGavin/ols",
  },
  lua: {
    language: "Lua (LuaLS)",
    command: "lua-language-server",
    args: [],
    fileTypes: [".lua"],
    rootMarkers: [
      ".luarc.json",
      ".luarc.jsonc",
      ".luacheckrc",
      ".stylua.toml",
      "stylua.toml",
      "main.lua",
      "init.lua",
      ".git",
    ],
    settings: {
      Lua: {
        workspace: { checkThirdParty: false },
        telemetry: { enable: false },
      },
    },
    install:
      "https://github.com/LuaLS/lua-language-server/releases (brew install lua-language-server)",
  },
  glsl: {
    language: "GLSL shaders",
    command: "glsl_analyzer",
    args: [],
    fileTypes: [".glsl", ".vert", ".frag", ".geom", ".comp", ".tesc", ".tese"],
    rootMarkers: [".git"],
    install: "https://github.com/nolanderc/glsl_analyzer/releases",
  },
  wgsl: {
    language: "WGSL shaders",
    command: "wgsl-analyzer",
    args: [],
    fileTypes: [".wgsl"],
    rootMarkers: ["Cargo.toml", ".git"],
    install:
      "cargo install --git https://github.com/wgsl-analyzer/wgsl-analyzer wgsl-analyzer",
  },
  cmake: {
    language: "CMake",
    command: "cmake-language-server",
    args: [],
    fileTypes: [".cmake", "CMakeLists.txt"],
    rootMarkers: ["CMakeLists.txt"],
    install: "pip install cmake-language-server",
  },

  // --- Application languages -------------------------------------------------
  java: {
    language: "Java",
    command: "jdtls",
    args: [],
    fileTypes: [".java"],
    rootMarkers: [...JVM_MARKERS, ".project"],
    install:
      "https://github.com/eclipse-jdtls/eclipse.jdt.ls (jdtls launcher on PATH)",
  },
  kotlin: {
    language: "Kotlin",
    command: "kotlin-lsp",
    args: ["--stdio"],
    fileTypes: [".kt", ".kts"],
    rootMarkers: JVM_MARKERS,
    install: "https://github.com/Kotlin/kotlin-lsp (kotlin-lsp on PATH)",
  },
  scala: {
    language: "Scala",
    command: "metals",
    args: [],
    fileTypes: [".scala", ".sbt", ".sc"],
    rootMarkers: ["build.sbt", "build.sc", "build.gradle", "pom.xml"],
    initializationOptions: { statusBarProvider: "off", isHttpEnabled: false },
    install: "coursier install metals",
  },
  dart: {
    language: "Dart / Flutter",
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    fileTypes: [".dart"],
    rootMarkers: ["pubspec.yaml", "pubspec.lock"],
    requiredMarkers: ["pubspec.yaml"],
    install: "https://dart.dev/get-dart (dart on PATH)",
  },
  swift: {
    language: "Swift",
    command: "sourcekit-lsp",
    args: [],
    fileTypes: [".swift"],
    rootMarkers: [
      "Package.swift",
      "*.xcodeproj",
      "*.xcworkspace",
      "project.yml",
      ".swiftpm",
    ],
    install: "ships with Xcode / swift.org toolchains",
  },
  ruby: {
    language: "Ruby",
    command: "ruby-lsp",
    args: [],
    fileTypes: [".rb", ".rake", ".gemspec", ".erb"],
    rootMarkers: ["Gemfile", ".ruby-version", ".ruby-gemset"],
    initializationOptions: { formatter: "none" },
    install: "gem install ruby-lsp",
  },
  solargraph: {
    language: "Ruby (Solargraph)",
    command: "solargraph",
    args: ["stdio"],
    fileTypes: [".rb", ".rake", ".gemspec"],
    rootMarkers: ["Gemfile", ".solargraph.yml", "Rakefile"],
    settings: {
      solargraph: {
        diagnostics: true,
        hover: true,
        references: true,
        symbols: true,
      },
    },
    install: "gem install solargraph",
  },
  elixir: {
    language: "Elixir",
    command: "elixir-ls",
    args: [],
    fileTypes: [".ex", ".exs", ".heex", ".eex"],
    rootMarkers: ["mix.exs", "mix.lock"],
    settings: { elixirLS: { dialyzerEnabled: false, fetchDeps: false } },
    install: "https://github.com/elixir-lsp/elixir-ls/releases",
  },
  gleam: {
    language: "Gleam",
    command: "gleam",
    args: ["lsp"],
    fileTypes: [".gleam"],
    rootMarkers: ["gleam.toml"],
    install: "https://gleam.run/getting-started/installing",
  },
  erlang: {
    language: "Erlang",
    command: "erlang_ls",
    args: [],
    fileTypes: [".erl", ".hrl"],
    rootMarkers: ["rebar.config", "erlang.mk", "rebar.lock"],
    install: "https://github.com/erlang-ls/erlang_ls",
  },
  haskell: {
    language: "Haskell",
    command: "haskell-language-server-wrapper",
    args: ["--lsp"],
    fileTypes: [".hs", ".lhs"],
    rootMarkers: [
      "stack.yaml",
      "cabal.project",
      "hie.yaml",
      "package.yaml",
      "*.cabal",
    ],
    install: "ghcup install hls",
  },
  ocaml: {
    language: "OCaml",
    command: "ocamllsp",
    args: [],
    fileTypes: [".ml", ".mli", ".mll", ".mly"],
    rootMarkers: ["dune-project", "dune-workspace", "*.opam", ".ocamlformat"],
    install: "opam install ocaml-lsp-server",
  },
  nix: {
    language: "Nix",
    command: "nixd",
    args: [],
    fileTypes: [".nix"],
    rootMarkers: ["flake.nix", "default.nix", "shell.nix"],
    install: "nix profile install nixpkgs#nixd (or nil)",
  },

  // --- Scripting, config, docs -------------------------------------------------
  bash: {
    language: "Shell",
    command: "bash-language-server",
    args: ["start"],
    fileTypes: [".sh", ".bash", ".zsh"],
    rootMarkers: [".git"],
    npm: "bash-language-server",
    install:
      "coffee-lsp install bash (npm: bash-language-server; shellcheck on PATH for lint)",
  },
  yaml: {
    language: "YAML",
    command: "yaml-language-server",
    args: ["--stdio"],
    fileTypes: [".yaml", ".yml"],
    rootMarkers: [".git"],
    settings: {
      yaml: {
        validate: true,
        hover: true,
        completion: false,
        format: { enable: false },
      },
      redhat: { telemetry: { enabled: false } },
    },
    npm: "yaml-language-server",
    install: "coffee-lsp install yaml (npm: yaml-language-server)",
  },
  toml: {
    language: "TOML",
    command: "taplo",
    args: ["lsp", "stdio"],
    fileTypes: [".toml"],
    rootMarkers: [
      ".taplo.toml",
      "taplo.toml",
      "Cargo.toml",
      "pyproject.toml",
      ".git",
    ],
    npm: "@taplo/cli",
    install:
      "coffee-lsp install toml (npm: @taplo/cli; or cargo install taplo-cli)",
  },
  markdown: {
    language: "Markdown",
    command: "marksman",
    args: ["server"],
    fileTypes: [".md", ".markdown"],
    rootMarkers: [".marksman.toml", ".git"],
    install:
      "https://github.com/artempyanykh/marksman/releases (brew install marksman)",
    disabled: true,
  },
  dockerfile: {
    language: "Dockerfile",
    command: "docker-langserver",
    args: ["--stdio"],
    fileTypes: ["Dockerfile", ".dockerfile"],
    rootMarkers: [
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yaml",
      ".git",
    ],
    npm: "dockerfile-language-server-nodejs",
    install:
      "coffee-lsp install dockerfile (npm: dockerfile-language-server-nodejs)",
  },
  terraform: {
    language: "Terraform",
    command: "terraform-ls",
    args: ["serve"],
    fileTypes: [".tf", ".tfvars"],
    rootMarkers: [".terraform", "terraform.tfstate", "*.tf"],
    install:
      "https://github.com/hashicorp/terraform-ls (brew install terraform-ls)",
  },
  latex: {
    language: "LaTeX",
    command: "texlab",
    args: [],
    fileTypes: [".tex", ".bib", ".sty", ".cls"],
    rootMarkers: [
      ".latexmkrc",
      "latexmkrc",
      ".texlabroot",
      "texlabroot",
      "Tectonic.toml",
      ".git",
    ],
    install: "https://github.com/latex-lsp/texlab/releases",
  },
  typst: {
    language: "Typst",
    command: "tinymist",
    args: ["lsp"],
    fileTypes: [".typ"],
    rootMarkers: ["typst.toml", ".git"],
    install: "cargo install tinymist (or a release binary)",
  },
};

/** Legacy environment override names for the original six profiles. */
const LEGACY_OVERRIDE_VARIABLES: Record<string, string> = {
  typescript: "PI_COFFEE_TS_LSP_COMMAND",
  python: "PI_COFFEE_PYTHON_LSP_COMMAND",
  csharp: "PI_COFFEE_CSHARP_LSP_COMMAND",
  cpp: "PI_COFFEE_CPP_LSP_COMMAND",
  rust: "PI_COFFEE_RUST_LSP_COMMAND",
  go: "PI_COFFEE_GO_LSP_COMMAND",
};

/** Environment variable that overrides one server's command line (JSON argv array). */
export function overrideVariable(id: string): string {
  return (
    LEGACY_OVERRIDE_VARIABLES[id] ??
    `PI_COFFEE_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_LSP_COMMAND`
  );
}

const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".cs": "csharp",
  ".csx": "csharp",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".cu": "cuda-cpp",
  ".cuh": "cuda-cpp",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".rs": "rust",
  ".go": "go",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".json": "json",
  ".jsonc": "jsonc",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".prisma": "prisma",
  ".php": "php",
  ".phtml": "php",
  ".zig": "zig",
  ".zon": "zig",
  ".odin": "odin",
  ".lua": "lua",
  ".glsl": "glsl",
  ".vert": "glsl",
  ".frag": "glsl",
  ".geom": "glsl",
  ".comp": "glsl",
  ".tesc": "glsl",
  ".tese": "glsl",
  ".wgsl": "wgsl",
  ".cmake": "cmake",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sbt": "scala",
  ".sc": "scala",
  ".dart": "dart",
  ".swift": "swift",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".erb": "erb",
  ".ex": "elixir",
  ".exs": "elixir",
  ".heex": "phoenix-heex",
  ".eex": "eex",
  ".gleam": "gleam",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".mll": "ocaml",
  ".mly": "ocaml",
  ".nix": "nix",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".markdown": "markdown",
  ".dockerfile": "dockerfile",
  ".tf": "terraform",
  ".tfvars": "terraform-vars",
  ".tex": "latex",
  ".sty": "latex",
  ".cls": "latex",
  ".bib": "bibtex",
  ".typ": "typst",
};

const FILENAME_LANGUAGE_IDS: Record<string, string> = {
  dockerfile: "dockerfile",
  "cmakelists.txt": "cmake",
};

export function languageIdFor(path: string, override?: string): string {
  if (override) return override;
  const name = basename(path).toLowerCase();
  return (
    FILENAME_LANGUAGE_IDS[name] ??
    LANGUAGE_IDS[extname(path).toLowerCase()] ??
    "plaintext"
  );
}

/** True when a registry entry lists this file's extension or exact name. */
export function matchesFileType(
  definition: ServerDefinition,
  path: string,
): boolean {
  const extension = extname(path).toLowerCase();
  const name = basename(path).toLowerCase();
  return definition.fileTypes.some((type) => {
    const value = type.toLowerCase();
    return value.startsWith(".") ? value === extension : value === name;
  });
}

/** Any marker present in `directory` (one directory level; `*.ext` patterns supported). */
export function hasRootMarkers(
  directory: string,
  markers: readonly string[],
): boolean {
  let entries: string[] | undefined;
  for (const marker of markers) {
    if (marker.includes("*")) {
      try {
        entries ??= readdirSync(directory);
      } catch {
        entries = [];
      }
      const suffix = marker.slice(marker.indexOf("*") + 1);
      const prefix = marker.slice(0, marker.indexOf("*"));
      if (
        entries.some(
          (entry) => entry.startsWith(prefix) && entry.endsWith(suffix),
        )
      )
        return true;
    } else if (existsSync(resolve(directory, marker))) return true;
  }
  return false;
}

export function coffeeLspHome(env: NodeJS.ProcessEnv): string {
  return (
    env.PI_COFFEE_LSP_HOME?.trim() ||
    join(
      env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"),
      "coffee-lsp",
    )
  );
}

/** npm prefix used by `coffee-lsp install`; its `node_modules/.bin` is searched after project bins. */
export function managedNpmPrefix(env: NodeJS.ProcessEnv): string {
  return join(coffeeLspHome(env), "npm");
}

// ---------------------------------------------------------------------------
// Configuration files
// ---------------------------------------------------------------------------

export interface RegistryLoadOptions {
  /** Directories whose `coffee-lsp.json` may carry a `servers` section, lowest precedence first. */
  configDirectories: string[];
}

/** Directories consulted for `coffee-lsp.json`, lowest precedence first. */
export function configDirectories(
  projectRoot: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const agent =
    env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  const directories = [agent, resolve(workspace)];
  const root = resolve(projectRoot);
  if (root !== resolve(workspace)) directories.push(root);
  return directories;
}

const cache = new Map<string, { stamp: string; registry: ServerRegistry }>();

/**
 * Built-in registry merged with every `servers` section found in
 * `configDirectories`. Unknown ids define new servers and need `command`,
 * `fileTypes` and `rootMarkers`; known ids may override any field or set
 * `disabled`. Malformed sections are ignored so a broken user file never
 * removes a language.
 */
export function loadServerRegistry(
  options: RegistryLoadOptions,
): ServerRegistry {
  const files = options.configDirectories.map((directory) =>
    join(directory, "coffee-lsp.json"),
  );
  const stamp = files
    .map((file) => {
      try {
        const stats = statSync(file);
        return `${file}:${stats.mtimeMs}:${stats.size}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
  const cached = cache.get(files.join("|"));
  if (cached && cached.stamp === stamp) return cached.registry;
  let registry: ServerRegistry = Object.fromEntries(
    Object.entries(BUILTIN_SERVERS).map(([id, definition]) => [
      id,
      { ...definition },
    ]),
  );
  for (const file of files) {
    const section = readServersSection(file);
    if (section) registry = mergeServers(registry, section);
  }
  cache.set(files.join("|"), { stamp, registry });
  return registry;
}

function readServersSection(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const servers = parsed?.servers;
    return servers && typeof servers === "object" && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function mergeServers(
  base: ServerRegistry,
  overrides: Record<string, unknown>,
): ServerRegistry {
  const merged: ServerRegistry = { ...base };
  for (const [id, raw] of Object.entries(overrides)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const { initOptions, ...override } = raw as Record<string, unknown>;
    const candidate = {
      ...(merged[id] ?? {}),
      ...override,
      ...(initOptions !== undefined &&
      override.initializationOptions === undefined
        ? { initializationOptions: initOptions }
        : {}),
    };
    const normalized = normalizeDefinition(id, candidate);
    if (normalized) merged[id] = normalized;
  }
  return merged;
}

function normalizeDefinition(
  id: string,
  raw: Record<string, unknown>,
): ServerDefinition | undefined {
  const command =
    typeof raw.command === "string" && raw.command.trim()
      ? raw.command.trim()
      : undefined;
  const fileTypes = stringArray(raw.fileTypes);
  const rootMarkers = stringArray(raw.rootMarkers);
  if (!command || !fileTypes || !rootMarkers) return undefined;
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  return {
    language: typeof raw.language === "string" ? raw.language : id,
    command,
    args: stringArray(raw.args) ?? (Array.isArray(raw.args) ? [] : undefined),
    fileTypes,
    rootMarkers,
    requiredMarkers: stringArray(raw.requiredMarkers),
    languageId: typeof raw.languageId === "string" ? raw.languageId : undefined,
    settings: object(raw.settings),
    initializationOptions:
      object(raw.initializationOptions) ?? object(raw.initOptions),
    isLinter: raw.isLinter === true,
    allowVersionlessDiagnostics: raw.allowVersionlessDiagnostics === true,
    install: typeof raw.install === "string" ? raw.install : undefined,
    npm: typeof raw.npm === "string" ? raw.npm : undefined,
    disabled: raw.disabled === true,
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return items.length ? items : undefined;
}

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat", ".ps1"];

function executable(base: string): string | undefined {
  if (existsSync(base)) return base;
  if (process.platform !== "win32") return undefined;
  for (const extension of WINDOWS_EXTENSIONS)
    if (existsSync(base + extension)) return base + extension;
  return undefined;
}

export interface ResolvedExecutable {
  command: string;
  source: "project" | "managed" | "path";
}

/**
 * Project-local bin directories searched from `projectRoot` upwards (npm
 * `.bin`, Python virtual environments, Ruby/Go `bin` next to their manifests),
 * then the managed npm prefix, then PATH. Paths containing a separator are
 * taken literally relative to the project root.
 */
export function resolveExecutable(
  command: string,
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): ResolvedExecutable | undefined {
  if (command.includes("/") || command.includes("\\")) {
    const literal = executable(resolve(projectRoot, command));
    return literal ? { command: literal, source: "project" } : undefined;
  }
  const localBins: Array<{ bin: string; markers?: string[] }> = [
    { bin: "node_modules/.bin" },
    { bin: ".venv/bin" },
    { bin: ".venv/Scripts" },
    { bin: "venv/bin" },
    { bin: "venv/Scripts" },
    { bin: "bin", markers: ["Gemfile", "go.mod", "go.work"] },
  ];
  let directory = resolve(projectRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const { bin, markers } of localBins) {
      if (markers && !hasRootMarkers(directory, markers)) continue;
      const found = executable(join(directory, bin, command));
      if (found) return { command: found, source: "project" };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const managed = executable(
    join(managedNpmPrefix(env), "node_modules", ".bin", command),
  );
  if (managed) return { command: managed, source: "managed" };
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  for (const entry of (env[pathKey] ?? "").split(delimiter)) {
    if (!entry) continue;
    const found = executable(join(entry, command));
    if (found) return { command: found, source: "path" };
  }
  return undefined;
}

export interface TypeScriptInstallation {
  /** `node_modules/typescript` directory. */
  packageDir: string;
  lib: string;
  /** TypeScript 7+ ships a native binary (`tsc --lsp`) and no `lib/tsserver.js`. */
  native: boolean;
}

/** Nearest `node_modules/typescript` from `projectRoot` upwards. */
export function findTypeScriptInstallation(
  projectRoot: string,
): TypeScriptInstallation | undefined {
  let directory = resolve(projectRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    const packageDir = join(directory, "node_modules", "typescript");
    if (existsSync(join(packageDir, "package.json"))) {
      const lib = join(packageDir, "lib");
      return {
        packageDir,
        lib,
        native: !existsSync(join(lib, "tsserver.js")),
      };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** `lib` directory of the nearest JavaScript TypeScript (with the `typescript.js` API), for `${tsdk}`. */
export function findTypeScriptSdk(projectRoot: string): string | undefined {
  const installation = findTypeScriptInstallation(projectRoot);
  return installation && existsSync(join(installation.lib, "typescript.js"))
    ? installation.lib
    : undefined;
}

export function projectUsesNativeTypeScript(projectRoot: string): boolean {
  return findTypeScriptInstallation(projectRoot)?.native === true;
}

/**
 * Whether a resolved `tsc` executable is the native TypeScript 7+ compiler
 * (whose `--lsp` flag starts a language server) rather than the `tsc.js`
 * wrapper of TypeScript 5.
 */
export function isNativeTsc(command: string): boolean {
  let target = command;
  try {
    target = realpathSync(command);
  } catch {
    return false;
  }
  let directory = dirname(target);
  for (let depth = 0; depth < 4; depth += 1) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        if (parsed?.name === "typescript")
          return !existsSync(join(directory, "lib", "tsserver.js"));
      } catch {
        return false;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}
