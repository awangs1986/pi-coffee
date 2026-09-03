import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { WebSearchResult } from "./search.js";

export interface ResearchArtifactInput {
  responseId: string;
  sessionId?: string;
  queries: string[];
  provider: string;
  results: WebSearchResult[];
  conclusion: string;
  sealedAt?: string;
}
export interface ResearchArtifactRef {
  artifactId: string;
  path: string;
  sha256: string;
  bytes: number;
  pointer: string;
}

/** Markdown closure owned by the User VM; only its pointer returns to context. */
export class ResearchArtifactStore {
  constructor(private readonly root: string = resolveResearchRoot()) {}

  seal(input: ResearchArtifactInput): ResearchArtifactRef {
    const markdown = renderResearchMarkdown(input);
    const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
    const artifactId = `research-${sha256.slice(0, 20)}`;
    const path = join(this.root, `${artifactId}.md`);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temporary = join(this.root, `.${artifactId}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(temporary, markdown, { encoding: "utf8", mode: 0o600 });
    try { chmodSync(temporary, 0o600); } catch { /* Windows */ }
    renameSync(temporary, path);
    try { chmodSync(path, 0o600); } catch { /* Windows */ }
    const bytes = Buffer.byteLength(markdown, "utf8");
    return {
      artifactId,
      path,
      sha256,
      bytes,
      pointer: `Research artifact ${artifactId} (sha256:${sha256.slice(0, 16)}; User VM path: ${path})`,
    };
  }

  read(ref: ResearchArtifactRef): string {
    const candidate = resolve(ref.path);
    const root = resolve(this.root);
    if (candidate !== join(root, `${ref.artifactId}.md`)) throw new Error("artifact path is outside the configured research root");
    return readFileSync(candidate, "utf8");
  }
}

export function renderResearchMarkdown(input: ResearchArtifactInput): string {
  const conclusion = redactSecrets(input.conclusion).trim().slice(0, 32_000) || "(no conclusion recorded)";
  const lines = [
    "# PI Coffee Research Closure",
    "",
    `- Sealed at: ${input.sealedAt ?? new Date().toISOString()}`,
    `- Provider: ${safeInline(input.provider)}`,
    `- Response: ${safeInline(input.responseId)}`,
    ...(input.sessionId ? [`- Session: ${safeInline(input.sessionId)}`] : []),
    `- Queries: ${input.queries.map(safeInline).join(" | ")}`,
    "",
    "## Conclusion",
    "",
    conclusion,
    "",
    "## Sources",
    "",
  ];
  if (input.results.length === 0) lines.push("_No sources returned._");
  input.results.slice(0, 80).forEach((result, index) => {
    lines.push(`${index + 1}. [${markdownLabel(result.title)}](${safeUrl(result.url)})`);
    const snippet = redactSecrets(result.snippet).trim().slice(0, 1_000);
    if (snippet) lines.push(`   ${snippet.replace(/\n+/g, " ")}`);
  });
  return `${lines.join("\n")}\n`;
}

export function pointerContext(ref: ResearchArtifactRef, conclusion: string): string {
  return `[Research sealed] ${ref.pointer}\nConclusion: ${redactSecrets(conclusion).trim().slice(0, 8_000)}`;
}

export function resolveResearchRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_COFFEE_RESEARCH_DIR?.trim();
  if (configured) return configured;
  const agentDir = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(agentDir, "pi-coffee", "research");
}

function safeInline(value: string): string {
  return redactSecrets(value).replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").slice(0, 2_048);
}

function markdownLabel(value: string): string {
  return safeInline(value).replace(/[\[\]]/g, "");
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "about:blank";
    return url.toString().replace(/[()]/g, (char) => encodeURIComponent(char));
  } catch {
    return "about:blank";
  }
}

export function redactSecrets(value: string): string {
  const secrets = [
    process.env.PI_COFFEE_UPSTREAM_KEY,
    process.env.PI_COFFEE_RELAY_TOKEN,
    process.env.PI_COFFEE_SERPER_KEY,
    process.env.SERPER_API_KEY,
  ].filter((secret): secret is string => typeof secret === "string" && secret.length > 3);
  return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
}
