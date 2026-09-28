# pi-coffee-lsp

Language-server intelligence for [Pi](https://github.com/earendil-works/pi-mono)
0.87.1, shipped as a standard Pi package (extension + Skill + CLI):

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

Requires Node >=22.19.0 and Pi 0.87.1.

```bash
pi install npm:pi-coffee-lsp          # personal install (~/.pi/agent/settings.json)
pi install npm:pi-coffee-lsp --local  # project install (.pi/settings.json)
pi -e npm:pi-coffee-lsp               # try it for one session without installing
```

Pi installs the package into its own npm root, loads
`dist/src/extension/index.js` and `dist/skills/lsp` from the `pi` manifest, and
keeps the bundled `typescript-language-server` / `pyright` inside that root. Pi
itself and `typebox` are `peerDependencies`, as the Pi package specification
requires; they are never copied into the package. Use `pi update` to upgrade and
`pi remove npm:pi-coffee-lsp` to uninstall.

From a checkout (for development):

```bash
npm ci && npm run build
pi install /absolute/path/to/pi-coffee-lsp
```

`pi install git:github.com/awangs1986/pi-coffee-lsp` clones the repository and
runs `npm install --omit=dev`, which cannot build TypeScript; the install
succeeds with a notice but nothing loads until `dist/` exists. Prefer the npm
package, or run `npm install && npm run build` inside the cloned directory.

Load the extension once: Pi rejects a second copy (`Tool "lsp" conflicts`), so
do not combine `pi install` with `pi -e ./dist/src/extension/index.js` or with
the older all-in-one pi-coffee package.

Inside a Pi session the extension puts the package's `coffee-lsp` launcher on
the Bash `PATH` and exports `PI_COFFEE_ROOT_SESSION`, so Skill-driven Bash
calls share the session's language servers. Outside Pi, a plain
`npm install --global pi-coffee-lsp` provides the executable.

## Inside Pi

### The `lsp` tool

```
lsp { operation: "symbols",     file: "src/game.ts" }
lsp { operation: "definition",  file: "src/game.ts", line: 12, column: 8 }
lsp { operation: "references",  file: "src/game.ts", line: 12, column: 8, includeDeclaration: true }
lsp { operation: "hover",       file: "src/game.ts", line: 12, column: 8 }
lsp { operation: "diagnostics", file: "src/game.ts", files: ["src/scene.ts"], timeoutMs: 30000 }
```

Positions are 1-based lines and Unicode code-point columns, exactly as in the
CLI. Results are one line per item (`path:line:col severity source(code) message`,
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
Only the edited file is checked; dependents are not re-diagnosed automatically,
use `lsp diagnostics` with `files` for that.

Reading a supported file (`read`) starts its project's language server in the
background once per project, so the first edit usually meets a warm server.

### `/lsp` command

| Command | Effect |
| --- | --- |
| `/lsp status` | session id, daemon socket, current automatic-diagnostics settings, last automatic check |
| `/lsp check <file>` | run diagnostics for one file with a 30-second budget and show the result |
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
working directory; environment variables win over both. Language-server
`settings` / `initializationOptions` continue to live under the profile ids of
the same file.

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
| `PI_COFFEE_<TS\|PYTHON\|CSHARP\|CPP\|RUST\|GO>_LSP_COMMAND` | JSON argv array replacing a language server |

## Query saved source from Bash

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
and server-requested edits are outside the read-only interface. TypeScript
projects must have `typescript` installed in their own `node_modules`; the bundled
server does not carry a compiler.

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
