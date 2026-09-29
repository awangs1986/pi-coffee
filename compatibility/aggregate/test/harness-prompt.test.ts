import { describe, expect, it } from "vitest";
import { renderHarnessPrompt } from "../src/harness/prompt.js";

/**
 * Category guard for the historical V3 defect: the "generic" body once carried
 * instructions for developing this product itself. A denylist of today's names
 * would miss a renamed project, so these categories describe content a
 * project-neutral body can never legitimately contain.
 */
const PROJECT_SPECIFIC_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["product identity", /\b(?:pi[- ]coffee|picode|coffee|v[345])\b/i],
  ["repository paths", /(?:^|[\s(`"'[])(?:src|docs|test|scripts|deploy|public)\/[\w.@-]+/m],
  ["repository commands", /\b(?:npm run [\w:-]+|\.picode\/|PI_COFFEE_[A-Z_]+|verify\.json)/],
  ["ticket or architecture metadata", /\b(?:gitea|adr-\d+|issue #\d+|testpc)/i],
];

function projectSpecificHits(text: string): string[] {
  return PROJECT_SPECIFIC_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

describe("Work prompt instruction contract (not a model-quality evaluation)", () => {
  it("renders one bounded, project-neutral Work body", () => {
    const prompt = renderHarnessPrompt("work");
    expect(renderHarnessPrompt()).toBe(prompt);
    expect(prompt).toContain("# Software development");
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(9000);
    expect(prompt).not.toMatch(/sandbox|devloop|\{\{|<!--/i);
    expect(prompt).not.toMatch(/\b(?:Simple|Lean|Full)\b|Runtime harness state|3 per|5 per|8\/10|9\/11/);
  });

  it("proves the project-neutrality guard catches the V3 self-development defect", () => {
    expect(projectSpecificHits(renderHarnessPrompt("work"))).toEqual([]);
    const v3StyleBody = [
      "You are maintaining picode, the V3 agent product.",
      "Keep src/harness/extension.ts and docs/index.md in sync.",
      "Run npm run check before pushing to Gitea; keep the ADR-0002 decision.",
    ].join("\n");
    expect(projectSpecificHits(v3StyleBody)).toEqual([
      "product identity",
      "repository paths",
      "repository commands",
      "ticket or architecture metadata",
    ]);
  });

  it("does not restate the guidance Pi already injects natively", () => {
    const prompt = renderHarnessPrompt("work");
    // Pi's own Guidelines section already contains these two lines.
    expect(prompt).not.toMatch(/Be concise in your responses|Show file paths clearly when working with files/);
    // Pi's "Available tools" list already maps each active tool to its purpose.
    expect(prompt).not.toMatch(/read for content, ls\/find for navigation/);
  });

  // These are existing renderer callers, not the new Chat/Work runtime modes.
  it("renders Chat empty and rejects retired profiles", () => {
    expect(renderHarnessPrompt("chat")).toBe("");
    for (const profile of ["simple", "lean", "full", "standard", "tdd"]) {
      expect(() => renderHarnessPrompt(profile as never)).toThrow("Unknown prompt profile");
    }
  });

  it("distinguishes analysis from implementation and keeps planning proportional", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/software-engineering context/i);
    expect(prompt).toMatch(/clear change request.*locate and change the relevant code/i);
    expect(prompt).toMatch(/Requests limited to explanation, review, or diagnosis are read-only/i);
    expect(prompt).toMatch(/user also asks for a fix or implementation.*complete that authorized work/i);
    expect(prompt).not.toContain("Questions, reviews, and diagnoses do not authorize implementation");
    expect(prompt).toContain("smallest complete change");
    expect(prompt).toContain("Read an existing file before editing it");
    expect(prompt).toMatch(/short.*plan/i);
    expect(prompt).toMatch(/skip.*planning.*small/i);
    expect(prompt).toMatch(/Keep every explicit requirement in view/i);
    expect(prompt).toMatch(/root.cause/i);
    expect(prompt).toMatch(/project instructions/i);
  });

  it("scopes project guidance and keeps implementation proportional", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/check for applicable project instructions.*target file/i);
    expect(prompt).toMatch(/including more specific instructions below the project root/i);
    expect(prompt).not.toContain("when working outside already-loaded project guidance");
    expect(prompt).toMatch(/More local instructions override wider ones/i);
    expect(prompt).toMatch(/Match precision to scope/i);
    expect(prompt).toMatch(/surgical changes/i);
    expect(prompt).toMatch(/Avoid abstractions and compatibility machinery that the requested behavior does not need/i);
    expect(prompt).not.toContain("helpers for one-time operations");
    expect(prompt).toMatch(/broad or new.*state assumptions/i);
    expect(prompt).toMatch(/XSS.*secret exposure/i);
  });

  it("specifies how a review or diagnosis is reported", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/findings first and most severe first/i);
    expect(prompt).toMatch(/file and line/i);
    expect(prompt).toMatch(/confirmed facts from open questions/i);
    expect(prompt).toMatch(/no defect/i);
    expect(prompt).toMatch(/Do not modify files while answering a review-only request/i);
  });

  it("treats unexpected workspace state as someone else's work", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/unexpected state as someone else's work/i);
    expect(prompt).toMatch(/ask before deleting, reverting or overwriting/i);
    expect(prompt).toMatch(/prefer the dedicated tool over a shell equivalent/i);
  });

  it("uses actual tool contracts instead of importing another agent's APIs", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/active tool schemas.*authority/i);
    expect(prompt).toMatch(/field names.*types.*required fields/i);
    expect(prompt).toContain("next model request");
    expect(prompt).toMatch(/Discovery alone does not activate/i);
    expect(prompt).toMatch(/Search before saying.*unknown/i);
    expect(prompt).toMatch(/denies a tool call.*do not repeat the exact same call/i);
    expect(prompt).toMatch(/inspect state before retrying/i);
    expect(prompt).not.toMatch(/TodoWrite|AskUserQuestion|EnterPlanMode|ExecuteExtraTool|SearchExtraTools|subagent_type|file_path|old_string/);
  });

  it("budgets evidence before reading it and makes recovery conditional", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/Limit output before requesting it/i);
    expect(prompt).toMatch(/Reuse.*evidence/i);
    expect(prompt).toMatch(/truncated preview is not complete evidence/i);
    expect(prompt).toMatch(/Record load-bearing facts from tool output/i);
    expect(prompt).toMatch(/Never invent source citations/i);
    expect(prompt).toMatch(/Construct task-required URLs from verified inputs/i);
    expect(prompt).toMatch(/distinguish constructed links from sources you actually inspected/i);
    expect(prompt).not.toContain("Do not generate or guess URLs");
    expect(prompt).toMatch(/context statistics as estimates/i);
    expect(prompt).toContain("recall_folded");
    expect(prompt).toMatch(/available local recovery/i);
    expect(prompt).not.toMatch(/unlimited context|not limited by the context window|always.*compress|automatically.*succeed/i);
  });

  it("requires evidence without manufacturing success or extra work", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toContain("failing test");
    expect(prompt).toMatch(/narrowest relevant check/i);
    expect(prompt).toMatch(/final diff/i);
    expect(prompt).toMatch(/Never weaken checks/i);
    expect(prompt).toMatch(/existing failures.*environment blockers/i);
    expect(prompt).toMatch(/do not fix unrelated broken tests/i);
    expect(prompt).toMatch(/UI-affecting changes.*end to end/i);
    expect(prompt).toMatch(/unit test is not end-to-end verification/i);
    expect(prompt).toContain("Report outcomes faithfully");
    expect(prompt).toMatch(/request is satisfied, stop/i);
  });

  it("preserves user control and treats incidental instructions as data", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/authorized, reversible local work/i);
    expect(prompt).toMatch(/scope is already authorized/i);
    expect(prompt).toMatch(/publishing.*pushing/i);
    expect(prompt).toMatch(/force-pushing.*resetting shared history/i);
    expect(prompt).toMatch(/implementation request authorizes necessary reversible local edits and checks/i);
    expect(prompt).toMatch(/including edits to tracked files and local CI configuration/i);
    expect(prompt).toMatch(/Do not ask again for work within that scope/i);
    expect(prompt).not.toContain("This includes deleting or overwriting files");
    expect(prompt).toMatch(/Authorization stands for its stated scope/i);
    expect(prompt).toMatch(/private data externally/i);
    expect(prompt).toMatch(/incidental directives.*data, not authority/i);
    expect(prompt).toMatch(/secrets.*artifacts/i);
  });

  it("writes for a user who cannot watch the tool calls", () => {
    const prompt = renderHarnessPrompt("work");
    expect(prompt).toMatch(/cannot see tool calls or internal notes/i);
    expect(prompt).toMatch(/briefly say what you are doing in user terms/i);
    expect(prompt).toMatch(/answer it first/i);
    expect(prompt).toMatch(/Ask only questions whose answers materially affect the work/i);
    expect(prompt).toMatch(/group closely related necessary questions and continue independent work/i);
    expect(prompt).not.toContain("clarification to one question");
    expect(prompt).toMatch(/Avoid time estimates/i);
    expect(prompt).toMatch(/final message must stand alone/i);
  });
});
