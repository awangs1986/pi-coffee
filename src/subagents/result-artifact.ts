import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { redactSecrets } from "../web/research-artifact.js";

export function boundSubagentResult(content: unknown, details?: unknown, root?: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map(part => part?.type === "text" ? part.text : "").join("\n") : "";
  const safeText = redactSecrets(text).replace(/\bsubagent_supervisor\b/g, "subagent");
  const data = details && typeof details === "object" ? details as Record<string, unknown> : {};
  const metadata: Record<string, unknown> = {};
  for (const key of ["mode", "runId", "asyncId", "asyncDir", "status", "isError", "timedOut", "stopped", "artifactPath", "sha256", "truncated"]) {
    const v = data[key];
    if (typeof v === "boolean" || (typeof v === "string" && v.length < 1024)) metadata[key] = v;
  }
  let serialized: string;
  try { serialized = redactSecrets(JSON.stringify({ content, details })); }
  catch { return { content: [{ type: "text", text: "Subagent output was not serializable; inspect child state. No evidence file saved." }], details: { ...metadata, isError: true } }; }
  if (Buffer.byteLength(serialized) <= 4000) return { content: [{ type: "text", text: safeText }], details: metadata };
  try {
    const dir = root ?? join(getAgentDir(), "pi-coffee", "subagent-results");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sha256 = createHash("sha256").update(serialized).digest("hex");
    const path = join(dir, `${sha256}.json`);
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, serialized, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
    return { content: [{ type: "text", text: `${Buffer.from(safeText).subarray(0, Math.max(0, Math.min(2400, 3500 - Buffer.byteLength(path)))).toString("utf8")}\n[Bounded subagent result; full evidence on VM]\nArtifact: ${path}\nRead only the relevant range.` }],
      details: { ...metadata, artifactPath: path, sha256, truncated: true } };
  } catch {
    return { content: [{ type: "text", text: "Subagent result archive failed. Full output omitted; inspect child state before retrying. No evidence file was saved." }],
      details: { ...metadata, isError: true, code: "artifact_write_failed" } };
  }
}
