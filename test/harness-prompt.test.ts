import { describe, expect, it } from "vitest";
import { renderHarnessPrompt } from "../src/harness/prompt.js";

describe("universal software development prompt", () => {
  it.each(["simple", "lean", "full"] as const)("uses identical instructions in %s", (profile) => {
    const prompt = renderHarnessPrompt(profile);
    expect(prompt).toBe(renderHarnessPrompt("simple"));
    expect(prompt).toContain("software development");
    expect(prompt).toContain("failing test");
    expect(prompt).toContain("smallest complete change");
    expect(prompt).toContain("Read an existing file before editing it");
    expect(prompt).toContain("Report outcomes faithfully");
    expect(prompt).toContain("recall_folded");
    expect(prompt).toContain("Questions, reviews, and diagnoses do not authorize implementation");
    expect(prompt).not.toMatch(/V3|V5|pi[- ]coffee|picode|sandbox|devloop|\{\{|<!--/i);
    expect(prompt.length).toBeLessThan(5000);
  });
});
