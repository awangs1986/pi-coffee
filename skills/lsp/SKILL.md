---
name: lsp
description: Use project language-server semantics for type diagnostics, symbols, definitions, references, implementation candidates, and hover when software work depends on more than text matching.
---

# LSP project intelligence

Use this skill when a task involves type errors, cross-file definitions or references, ambiguous same-name symbols, or the impact of changing an interface. Plain text search can find candidates; it does not prove that two names are the same symbol.

If an `lsp` tool is available in this session, prefer it: it runs the same operations (`status`, `symbols`, `definition`, `references`, `hover`, `implementation`, `diagnostics`, `servers`) with the same 1-based positions, returns compact text, and the session automatically appends language-server diagnostics to successful `edit` and `write` results. Everything below about positions, capabilities and interpreting results applies to the tool as well; use the Bash command when the tool is absent or when you need the raw JSON envelope. Both share the session's warm language servers.

The Bash interface is the `coffee-lsp` command. Start by checking the target file:

```bash
coffee-lsp status --file src/example.ts
```

Use the returned server state and only request supported operations. Positions are 1-based Unicode code-point line and column values. Obtain a reliable position from the current file or `symbols` before navigation:

```bash
coffee-lsp symbols --file src/example.ts
coffee-lsp definition --file src/example.ts --line 12 --column 8
coffee-lsp references --file src/example.ts --line 12 --column 8 --include-declaration
coffee-lsp hover --file src/example.ts --line 12 --column 8
coffee-lsp diagnostics --file src/example.ts
```

When `status` says the server is available and the task depends on types or symbol identity, do not stop at the status probe. Run at least one semantic operation that answers the task. For a semantic code change, run `diagnostics` before editing, use `definition` or `references` when cross-file identity or impact matters, and run `diagnostics` again after editing.

Read the JSON envelope, including `status`, `issues`, `coverage`, and `diagnosticState`. An empty navigation result means only that this query returned no match. Diagnostics are clean only when `diagnosticState` is `clean`; treat `inconclusive`, timeouts, missing servers, stale positions, and truncated coverage as explicit limitations.

Read relevant source before editing. After a change, rerun diagnostics for changed files and affected callers, then run the project's own compiler, tests, and lint through Bash. LSP evidence complements project checks and does not replace them. Keep queries narrow; do not scan the whole workspace when the task names specific files or symbols.

`status` only checks installation and project selection; `capabilityState: not_negotiated`
means no server has started. A semantic call negotiates support and may return
`unsupported_operation`. For interface, trait or virtual-method dispatch candidates:

```bash
coffee-lsp implementation --file src/example.ts --line 12 --column 8
```

Candidates do not prove which implementation executes at runtime. TS/JS (TypeScript 5
through typescript-language-server, TypeScript 7 through the native `tsc --lsp`) and
Python (Pyright) are bundled. Other languages come from a registry (web: HTML, CSS,
JSON, YAML, Vue, Svelte, Astro, ESLint, Tailwind; games: C#/OmniSharp, clangd, Lua,
GLSL/WGSL, Zig, Odin, Rust, CMake; applications: Go, Java, Kotlin, Dart, Swift, Ruby,
Bash, Dockerfile, and more) and need their executable installed. When `status` reports
`unavailable`, its issue message names the install command; `coffee-lsp servers` lists
every entry with its state, and `coffee-lsp install <id>` installs npm-distributed
servers (html, css, json, yaml, vue, svelte, astro, eslint, bash, dockerfile, toml,
tailwindcss, graphql, prisma, php) into a managed directory outside the project.
Native servers (clangd, rust-analyzer, gopls, csharp-ls, lua-language-server, zls, …)
must be installed by the user; ask before installing anything. Run from the task
checkout; use `--workspace` to bound project selection. SDKs, Cargo features/target and
Go build tags/environment must match the project's checks. Use `--timeout-ms 30000`
for a cold project. Missing dependencies or uncertain coverage require an explicit
limitation and the project's compiler/checks. Servers marked `role: linter` (ESLint,
Ruff, Biome, Tailwind) provide diagnostics only.

Documentation-only and ordinary text changes do not need LSP. For semantic changes,
choose the smallest useful set of queries; you do not need to call every operation.
Saved source changes are synchronized with a warm server; configuration changes
replace that server. Results describe saved files, and a changed file hash makes
an earlier navigation position stale. Pyright does not provide implementation
lookup; treat `unsupported_operation` as that backend limitation. A short cold
diagnostic query may be inconclusive; retry with the documented cold-project
budget and retain the project compiler/check as independent evidence.
