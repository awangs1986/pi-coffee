> Canonical source: [pi-coffee/packages/lsp](https://github.com/awangs1986/pi-coffee/tree/main/packages/lsp). Version `0.4.7`. Start with the [repository map](https://github.com/awangs1986/pi-coffee/blob/main/REPOSITORIES.md) and [release/install guide](https://github.com/awangs1986/pi-coffee/blob/main/docs/releases/README.md). The standalone repository is historical.

# pi-coffee-lsp

Version **0.4.7** · [Changelog](CHANGELOG.md) · [Upgrade and rollback](docs/releases.md).
Query the installed version with `/lsp version` in Pi, or `coffee-lsp --version` in a terminal.

Language-server intelligence for [Pi](https://github.com/earendil-works/pi-mono)
1.1.0 (also installed-package tested on 0.99.1), shipped as a standard Pi package (extension + Skill + CLI):

- **`lsp` tool** — diagnostics, symbols, definition, references, implementation and
  hover, rendered as compact text for the model.
- **Automatic diagnostics** — after every successful `edit`/`write` of a supported
  file, the language server's errors and warnings are appended to the tool result,
  so the model sees type errors without being asked to check.
- **`coffee-lsp` CLI and `lsp` Skill** — the same read-only JSON interface through
  Bash, for scripts and for Pi setups that only load Skills.

The read-only kernel was extracted from the reviewed OMP port in
[pi-coffee](https://github.com/awangs1986/pi-coffee). No Harness, Web, Host,
subagent, context-management or OMP Agent/TUI framework is included.

## Install

Requires Node >=22.19.0 and Pi 0.99.1 or 1.0.x/1.1.x. From a pinned checkout of
[pi-coffee](https://github.com/awangs1986/pi-coffee), build this package and register
its directory with Pi:

```sh
cd packages/lsp
npm ci
npm run check
pi install /absolute/path/to/pi-coffee/packages/lsp
```

For installation from the built `lsp/v0.4.7` release artifact, follow the
[shared install and release guide](../../docs/releases/README.md). Install the
verified tarball with npm into a permanent plugin directory, then use `pi install`
on that installed package directory. Public npm-registry publication is separate.
Keep exactly one registered copy; remove the previous registration before switching.

Pi loads the extension and Skill declared in the package manifest. Its bundled
TypeScript and Python servers stay with the package. Inside Pi, the extension adds
`coffee-lsp` to Bash PATH so Skill calls share the session daemon. For shell use
outside Pi, use the installed plugin directory's `node_modules/.bin/coffee-lsp`.

## Inside Pi

### The `lsp` tool

```
lsp { operation: "symbols",     file: "src/game.ts" }
lsp { operation: "definition",  file: "src/game.ts", symbol: "spawnEnemy" }
lsp { operation: "references",  file: "src/game.ts", symbol: "spawnEnemy#2", includeDeclaration: true }
lsp { operation: "hover",       file: "src/game.ts", line: 12, column: 8 }
lsp { operation: "diagnostics", file: "src/game.ts", files: ["src/scene.ts"], timeoutMs: 30000 }
lsp { operation: "servers" }
```

Positions are 1-based lines and Unicode code-point columns, exactly as in the
CLI. `symbol: "name"` resolves the position from the current file content
instead: the first whole-word occurrence, `name#2` the second, `line` alone
restricts the search to that line (`symbol_not_found` otherwise). The resolved
position is echoed in the result header. Results are one line per item (`path:line:col severity source(code) message`,
`line:col kind name`), followed by `! code: message` for every limitation the
CLI reports and a `next:` hint when one exists. The full JSON envelope is kept in
the tool result `details`. `invalid_arguments`, `server_failed` and
`daemon_failed` are raised as tool errors; everything else (no server, stale
position, inconclusive diagnostics, unsupported operation) is returned as text
so the model can react. The tool registers a prompt snippet telling the model to
prefer `lsp` over grep for symbol identity and to treat only `clean` as clean.

### Automatic diagnostics

After a successful `edit` or `write` whose target has a supported extension, the
extension runs `diagnostics` for that file with an 8-second budget and appends
one of:

```
LSP diagnostics (typescript): 1 error, 1 warning in src/game.ts
  src/game.ts:2:7 error typescript(2322): Type 'string' is not assignable to type 'number'.
  src/game.ts:9:1 warning typescript(6133): 'x' is declared but its value is never read.
```

```
LSP diagnostics (typescript): src/game.ts has no errors.
```

Errors are listed before warnings, at most ten items, with a count of any
remainder. When the result is inconclusive (cold server, stale snapshot, missing
toolchain) nothing is appended: absence of the section is never evidence of a
clean file. Failed tool calls and unsupported file types are left untouched.

Language servers that push diagnostics (TypeScript, Pyright, rust-analyzer,
gopls, …) re-check every open file after an edit. Errors (and warnings, unless
`includeWarnings` is off) that an edit newly causes in *other* files the session
has opened are appended once, under the edited file's verdict:

```
LSP diagnostics (typescript): src/enemy.ts has no errors.
LSP related diagnostics: this change newly caused 1 error in 1 other open file
  src/scene.ts:41:22 error typescript(2554): Expected 2 arguments, but got 1.
```

Only errors that were not present before the change are listed, so a long-broken
file does not repeat under every edit; `lsp diagnostics` on that file lists its
current state. The related set is the files opened in this session (reads,
edits, queries) up to 40, not the whole project.

Reading a supported file (`read`) opens it in its project's language server in
the background, so the first edit usually meets a warm server and the files the
model has looked at take part in related diagnostics. When the edited file's
language has no working server, a one-line hint says so once per server
(`LSP: no lua language server is installed, so main.lua is not checked after
edits. Install: …`, or for Godot: `LSP: gdscript language server unavailable
for player.gd (server_failed: language server not reachable at 127.0.0.1:6005
(ECONNREFUSED) open the project in the Godot editor …)`); files over 2 MiB are
skipped.

### `/lsp` command

| Command | Effect |
| --- | --- |
| `/lsp status` | session id, daemon socket, current automatic-diagnostics settings, last automatic check |
| `/lsp check <file>` | run diagnostics for one file with a 30-second budget and show the result |
| `/lsp servers` | the language-server registry: which servers are installed, missing (with install hints) or disabled |
| `/lsp install <id>` | install an npm-distributed server (html, css, json, yaml, vue, …) into the managed prefix |
| `/lsp auto on` / `off` | toggle automatic diagnostics for this session |
| `/lsp stop` / `restart` | stop the session's language servers (they restart on the next query) |

### Lifecycle

Each Pi process owns one `coffee-lsp` daemon (`PI_COFFEE_ROOT_SESSION=pi-<pid>-<start>`)
that keeps language servers warm across `/new`, `/resume`, `/fork` and `/reload`,
shuts down after 30 minutes of inactivity and is stopped when Pi quits. Bash
calls to `coffee-lsp` from the same Pi process share those servers because the
extension exports the same `PI_COFFEE_ROOT_SESSION`. If the variable was already
set when Pi started (an embedding host that owns the daemon), the extension uses
that daemon and never stops it. Parallel tool calls are serialized by the daemon.

### Configuration

Extension behaviour is read from the `pi` section of `coffee-lsp.json`, first in
the Pi agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`), then in the
working directory; environment variables win over both. The `servers` section
extends or overrides the language-server registry (see
[Languages](#languages)); the legacy per-profile sections (`"typescript": {
"settings": … }`) still work and take precedence over registry defaults.

```json
{
  "pi": {
    "autoDiagnostics": true,
    "autoDiagnosticsTimeoutMs": 8000,
    "maxItems": 10,
    "includeWarnings": true,
    "reportClean": true,
    "prewarm": true,
    "daemonIdleMs": 1800000
  },
  "servers": {
    "gdscript": { "port": 6008 },
    "markdown": { "disabled": false },
    "lua": { "settings": { "Lua": { "diagnostics": { "globals": ["love"] } } } }
  },
  "typescript": { "settings": {} }
}
```

| Environment variable | Meaning |
| --- | --- |
| `PI_COFFEE_LSP_AUTO_DIAGNOSTICS=0` | disable automatic diagnostics (`1` enables) |
| `PI_COFFEE_LSP_AUTO_TIMEOUT_MS` | automatic diagnostics budget |
| `PI_COFFEE_LSP_REPORT_CLEAN=0` | do not append the "has no errors" line |
| `PI_COFFEE_LSP_PREWARM=0` | do not start servers on `read` |
| `PI_COFFEE_LSP_IDLE_MS` | daemon idle shutdown |
| `PI_COFFEE_ROOT_SESSION` | override the session id used for the daemon socket |
| `PI_COFFEE_<ID>_LSP_COMMAND` | JSON argv array replacing the server with registry id `<ID>` (upper case, `-` → `_`); the historical `TS`, `PYTHON`, `CSHARP`, `CPP`, `RUST`, `GO` names still work |
| `PI_COFFEE_LSP_HOME` | directory for managed servers (default `<agent dir>/coffee-lsp`; `coffee-lsp install` writes to `<home>/npm`) |

## Query saved source from Bash

```bash
coffee-lsp status --file src/example.ts
coffee-lsp symbols --file src/example.ts
coffee-lsp definition --file src/example.ts --line 12 --column 8
coffee-lsp definition --file src/example.ts --symbol loadLevel      # first whole-word occurrence
coffee-lsp references --file src/example.ts --symbol loadLevel#2    # second occurrence
coffee-lsp hover --file src/example.ts --symbol loadLevel --line 12 # occurrence on that line
coffee-lsp implementation --file src/example.ts --line 12 --column 8
coffee-lsp diagnostics --file src/example.ts --timeout-ms 30000
coffee-lsp servers [--file src/App.vue]     # registry: installed / missing / disabled
coffee-lsp install yaml                     # npm-distributed servers only
```

Use actual symbol positions from the current source or a symbols result, or
`--symbol name[#n]` to have the position resolved from the file (the envelope's
`position` field shows what was used). Positions are 1-based Unicode code
points. Default operation budget is 10 seconds, maximum 60 seconds.
`--workspace` bounds project selection; `--no-daemon` runs an isolated query.
Diagnostics pass only when `diagnosticState` is `clean` with confirmed coverage.
Empty, stale, unsupported and inconclusive results are not success. Through the
daemon, a diagnostics envelope also carries `related`: errors and warnings the
latest change newly caused in other files that are open in the same session
(`coverage.relatedFiles` says how many were watched). Files over 2 MiB
(bundles, generated code) are refused with `file_too_large`.

## Languages

Servers come from a registry adapted from
[oh-my-pi](https://github.com/can1357/oh-my-pi)'s `lsp/defaults.json`: file
types, root markers, command lines and the settings needed for read-only
diagnostics and navigation. One server serves a file: language servers before
linters, then whichever has its markers at the project root, then registry
order. Executables resolve from the project (`node_modules/.bin`, `.venv`,
`venv`, `bin` next to `Gemfile`/`go.mod`, walking up), then the managed prefix
(`coffee-lsp install`), then PATH. `coffee-lsp servers` shows the result for a
workspace. `coffee-lsp install <id>` installs the npm-distributed entries below
into `PI_COFFEE_LSP_HOME/npm` (default `~/.pi/agent/coffee-lsp/npm`) without
touching the project; everything else is installed with the listed command and
picked up from PATH.

**Web**

| Id | Files | Server | Install |
| --- | --- | --- | --- |
| `typescript` | .ts .tsx .mts .cts .js .jsx .mjs .cjs | typescript-language-server 4.3.4 (bundled) with the project's TypeScript 5 | bundled; projects without `typescript`: `coffee-lsp install typescript` (managed TS 5) |
| `typescript-native` | same | TypeScript 7 native `tsc --lsp` — selected automatically when the project's `typescript` is 7+ | `npm i -D typescript` (7+) or `coffee-lsp install typescript-native` |
| `deno` | .ts .tsx .js .jsx (deno.json projects) | `deno lsp` | https://deno.com |
| `html` | .html .htm | vscode-html-language-server (symbols/hover; diagnostics for embedded CSS/JS) | `coffee-lsp install html` |
| `css` | .css .scss .sass .less | vscode-css-language-server | `coffee-lsp install css` |
| `json` | .json .jsonc | vscode-json-language-server | `coffee-lsp install json` |
| `vue` | .vue | @vue/language-server (template/CSS semantics; TS inside `.vue` needs the tsserver plugin setup) | `npm i -D @vue/language-server` or `coffee-lsp install vue` |
| `svelte` | .svelte | svelte-language-server | `npm i -D svelte-language-server` or `coffee-lsp install svelte` |
| `astro` | .astro | @astrojs/language-server | `npm i -D @astrojs/language-server` or `coffee-lsp install astro` |
| `tailwindcss` (lint) | .html .css .vue .svelte .astro .jsx .tsx … | @tailwindcss/language-server | `coffee-lsp install tailwindcss` |
| `eslint` (lint) | .js .ts .jsx .tsx .vue .svelte | vscode-eslint-language-server with the project's ESLint | `coffee-lsp install eslint` |
| `biome` (lint) | .js .ts .json .css … | `biome lsp-proxy` | `npm i -D @biomejs/biome` |
| `graphql` | .graphql .gql | graphql-language-service-cli | `coffee-lsp install graphql` |
| `prisma` | .prisma | @prisma/language-server | `coffee-lsp install prisma` |
| `php` | .php | intelephense | `coffee-lsp install php` |

**Games**

| Id | Files | Server | Install |
| --- | --- | --- | --- |
| `csharp` | .cs | csharp-ls | `dotnet tool install --global csharp-ls` |
| `omnisharp` | .cs .csx (Unity) | OmniSharp (`omnisharp -lsp`) | https://github.com/OmniSharp/omnisharp-roslyn/releases |
| `cpp` | .c .h .cc .cpp .cxx .hpp .hh .hxx .cu .m .mm | clangd (needs `compile_commands.json`, `build/compile_commands.json` or `.clangd`) | https://clangd.llvm.org/installation |
| `lua` | .lua | lua-language-server (LuaLS) | https://github.com/LuaLS/lua-language-server/releases |
| `glsl` | .glsl .vert .frag .geom .comp .tesc .tese | glsl_analyzer | https://github.com/nolanderc/glsl_analyzer/releases |
| `wgsl` | .wgsl | wgsl-analyzer | `cargo install --git https://github.com/wgsl-analyzer/wgsl-analyzer wgsl-analyzer` |
| `zig` | .zig .zon | zls | https://github.com/zigtools/zls/releases |
| `odin` | .odin | ols | https://github.com/DanielGavin/ols |
| `rust` | .rs | rust-analyzer (needs Cargo.toml or rust-project.json) | `rustup component add rust-analyzer` |
| `cmake` | .cmake CMakeLists.txt | cmake-language-server | `pip install cmake-language-server` |
| `gdscript` | .gd (needs project.godot) | Godot's built-in language server over TCP (`127.0.0.1:6005`); start the editor, or headless: `godot --path <project> --editor --headless --lsp-port 6005` | ships with Godot; change the port with `"servers": {"gdscript": {"port": 6008}}` |

**Applications & scripting**

| Id | Files | Server | Install |
| --- | --- | --- | --- |
| `python` | .py .pyi | Pyright 1.1.405 (bundled) | bundled (`basedpyright` entry available, disabled by default) |
| `ruff` (lint) | .py .pyi | `ruff server` | `pip install ruff` |
| `go` | .go | gopls (needs go.mod/go.work) | `go install golang.org/x/tools/gopls@latest` |
| `java` | .java | jdtls | https://github.com/eclipse-jdtls/eclipse.jdt.ls |
| `kotlin` | .kt .kts | kotlin-lsp | https://github.com/Kotlin/kotlin-lsp |
| `scala` | .scala .sbt .sc | metals | `coursier install metals` |
| `dart` | .dart (needs pubspec.yaml) | `dart language-server` (Flutter included) | https://dart.dev/get-dart |
| `swift` | .swift | sourcekit-lsp | Xcode / swift.org toolchains |
| `ruby` | .rb .rake .gemspec .erb | ruby-lsp (`solargraph` entry also available) | `gem install ruby-lsp` |
| `elixir` | .ex .exs .heex .eex | elixir-ls | https://github.com/elixir-lsp/elixir-ls/releases |
| `gleam` / `erlang` / `haskell` / `ocaml` / `nix` | .gleam / .erl .hrl / .hs .lhs / .ml .mli / .nix | gleam lsp / erlang_ls / haskell-language-server-wrapper / ocamllsp / nixd | see `coffee-lsp servers` |
| `bash` | .sh .bash .zsh | bash-language-server (lint via shellcheck on PATH) | `coffee-lsp install bash` |
| `yaml` | .yaml .yml | yaml-language-server | `coffee-lsp install yaml` |
| `toml` | .toml | taplo | `coffee-lsp install toml` |
| `dockerfile` | Dockerfile .dockerfile | dockerfile-language-server-nodejs | `coffee-lsp install dockerfile` |
| `terraform` | .tf .tfvars | terraform-ls | https://github.com/hashicorp/terraform-ls |
| `markdown` | .md | marksman (disabled by default: noisy for an agent's own notes) | enable via `"servers": {"markdown": {"disabled": false}}` |
| `latex` / `typst` | .tex .bib / .typ | texlab / tinymist | see `coffee-lsp servers` |

Entries marked *lint* are diagnostics-only servers; they are used for a file
only when no language server covers it (disable the language server in
`coffee-lsp.json` to lint instead). Additional project prerequisites remain:
C# needs an unambiguous `.sln`/`.slnx`/`.csproj` at the project root; clangd
needs a compilation database; Pyright does not advertise implementation lookup.
Rename, formatting, code actions and server-requested edits are outside the
read-only interface.

Every registry field can be overridden per server in `coffee-lsp.json` →
`servers.<id>`: `command`, `args`, `fileTypes`, `rootMarkers`,
`requiredMarkers`, `languageId`, `settings`, `initializationOptions` (alias
`initOptions`), `isLinter`, `disabled`, `install`, `npm`, and for servers that
listen on a socket instead of stdio `transport: "tcp"`, `host`, `port`. New ids
need `command` (or `transport`/`port`), `fileTypes` and `rootMarkers`. Files are
read from the agent directory, the workspace and the project root (later files
win); a malformed file is ignored rather than removing a language. `args`,
`settings` and `initializationOptions` may use `${pid}`, `${root}`,
`${rootUri}`, `${rootName}` and `${tsdk}` (the project's
`node_modules/typescript/lib`; entries whose value cannot be resolved are
dropped).

Project scanning (the change detection behind warm servers) skips VCS, package
and build output directories (`node_modules`, `.git`, `dist`, `build`, `.next`,
`target`, Unity `Library`/`Temp`/`Logs`/`obj`, Unreal `Intermediate`/`Saved`/
`DerivedDataCache`/`Binaries`, Godot `.godot`/`.import`, …) plus plain directory
names listed in the root `.gitignore`, and stops after 50,000 entries
(`snapshot_truncated` is then reported and change detection covers the scanned
part only).

## Embed

```js
import { resolvePiSkills, withCoffeeLspPath, stopLspDaemon } from "pi-coffee-lsp";

const sessionId = "my-task-unique-id";
const env = {
  ...process.env,
  ...withCoffeeLspPath(process.env),
  PI_COFFEE_ROOT_SESSION: sessionId,
};
const skills = resolvePiSkills(env);
// Pass env and skills to your Pi process. On task shutdown:
await stopLspDaemon(sessionId, env);
```

The caller owns task identity and lifecycle. Existing `PI_COFFEE_*` names and
daemon socket identity are retained for compatibility. Use separate session IDs
when running different versions side by side. `PI_COFFEE_SKILLS=off` disables
helper-based discovery; otherwise it can contain delimiter-separated Skill paths.
No Pi runtime is bundled or modified.

## Develop, verify, publish

```bash
npm ci
npm run check
npm run probe:languages
npm run probe:lifecycle
```

`check` builds, runs CLI regressions, the extension harness (`test/extension.test.ts`
drives the built extension with a stub Pi API against the fake language server)
and real TS/Python tests, then installs a tarball into an isolated consumer and
verifies the manifest, the public interface and the CLI. Manual verification
against a real Pi: `./node_modules/.bin/pi --mode rpc -e ./dist/src/extension/index.js`
and send `{"type":"prompt","message":"/lsp check src/app.ts"}` on stdin.

Publishing: `npm publish` runs `prepack` (`npm run build`) and uploads `dist/`
and this README. The `pi-package` keyword lists the package in Pi's gallery.
The six-language probe requires every native toolchain in the table. Evidence
limits and extraction identity are recorded in [docs/extraction.md](docs/extraction.md);
the feature review that motivated the extension is in
[docs/reviews/gap-analysis-20260928.md](docs/reviews/gap-analysis-20260928.md).

OMP attribution and its MIT license are preserved in
[third_party/oh-my-pi](third_party/oh-my-pi/README.md) and included in the tarball.
This extraction does not claim that model-autonomous LSP acceptance passed, does
not update existing consumers and does not deploy any service.
