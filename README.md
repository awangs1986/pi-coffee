# pi-coffee-lsp

Standalone read-only LSP CLI and Skill extracted from the reviewed OMP port in
[pi-coffee](https://github.com/awangs1986/pi-coffee). Compatible with unmodified
Pi 0.87.1. This package contains no Harness, Web, Host, subagent, context-management
or OMP Agent/TUI framework.

## Install

Requires Node >=22.19.0. Install the CLI and load its Skill into your existing Pi:

```bash
npm install --global git+https://github.com/awangs1986/pi-coffee-lsp.git
coffee-lsp --help
pi --skill "$(npm root -g)/pi-coffee-lsp/dist/skills/lsp"
```

For reproducible use, append `#<commit-sha>` to the Git URL. The package also
declares its Skill through the native `pi.skills` manifest. If using `pi install`
instead, ensure `coffee-lsp` is on the Pi Bash PATH; Skill discovery alone does
not install a global executable. Do not load a second `lsp` Skill from the older
all-in-one pi-coffee package in the same Pi instance.

## Query saved source

```bash
coffee-lsp status --file src/example.ts
coffee-lsp symbols --file src/example.ts
coffee-lsp definition --file src/example.ts --line 12 --column 8
coffee-lsp references --file src/example.ts --line 12 --column 8
coffee-lsp hover --file src/example.ts --line 12 --column 8
coffee-lsp implementation --file src/example.ts --line 12 --column 8
coffee-lsp diagnostics --file src/example.ts --timeout-ms 30000
```

Use actual symbol positions from the current source or a symbols result. Positions
are 1-based Unicode code points. Default operation budget is 10 seconds, maximum
60 seconds. `--workspace` bounds project selection; `--no-daemon` runs an isolated
query. Diagnostics pass only when `diagnosticState` is `clean` with confirmed
coverage. Empty, stale, unsupported and inconclusive results are not success.

| Language family | Server | Additional project prerequisites |
| --- | --- | --- |
| TS/JS | typescript-language-server 4.3.4 (bundled) | Project TypeScript compiler; tsconfig/jsconfig |
| Python | Pyright 1.1.405 (bundled) | Python environment and project configuration |
| C# | csharp-ls | .NET SDK and unambiguous solution/project |
| C/C++ | clangd | Compiler and compile_commands.json (also supported under build/) |
| Rust | rust-analyzer | Cargo, matching Rust toolchain and rust-src |
| Go | gopls | Go toolchain and go.mod/go.work |

Install native servers on PATH. Command overrides remain the existing
`PI_COFFEE_<TS|PYTHON|CSHARP|CPP|RUST|GO>_LSP_COMMAND` JSON argv arrays. Project
`coffee-lsp.json` can supply per-profile `settings` and `initializationOptions`.
Pyright does not advertise implementation lookup. Rename, formatting, code actions
and server-requested edits are outside the read-only interface.

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

## Develop and verify

```bash
npm ci
npm run check
npm run probe:languages
npm run probe:lifecycle
```

`check` builds, runs CLI regressions and real TS/Python tests, then installs a
tarball into an isolated consumer and verifies the public interface and CLI.
The six-language probe requires every native toolchain in the table. Evidence
limits and extraction identity are recorded in [docs/extraction.md](docs/extraction.md).

OMP attribution and its MIT license are preserved in
[third_party/oh-my-pi](third_party/oh-my-pi/README.md) and included in the tarball.
This extraction does not claim that model-autonomous LSP acceptance passed, does
not update existing consumers and does not deploy any service.
