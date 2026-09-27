import { describe, expect, it } from "vitest";
import { compactionNotice, isContextError } from "../public/context-status.js";

describe("browser recovery feedback", () => {
  it("does not announce success for failed or aborted compaction", () => {
    expect(compactionNotice({ aborted: true }).failure).toBe(true);
    expect(compactionNotice({ errorMessage: "disk full", aborted: false }).failure).toBe(true);
    expect(compactionNotice({}).failure).toBe(true);
    expect(compactionNotice({ result: { summary: "local" }, aborted: false }).failure).toBe(false);
  });
  it("recognizes local and provider overflow messages", () => {
    expect(isContextError("context_budget_exceeded")).toBe(true);
    expect(isContextError("maximum context length is 128000 tokens")).toBe(true);
    expect(isContextError("401 unauthorized")).toBe(false);
  });
});
