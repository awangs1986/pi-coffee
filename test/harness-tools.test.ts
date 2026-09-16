import { describe, expect, it } from "vitest";
import { createNativeGitTool, type NativeCommandResult, type NativeCommandRunner } from "../src/harness/native-git.js";
import { FULL_TOOLS, SIMPLE_TOOLS, resolveToolTable } from "../src/harness/mode.js";
import {
  createMemoryVerifyState,
  createNativeVerifyTool,
  executeProfile,
  type VerifyWorkspaceState,
} from "../src/harness/native-verify.js";

function context(cwd: string): any {
  return { cwd, signal: undefined };
}

function result(stdout = "", stderr = "", code = 0): NativeCommandResult {
  return { stdout, stderr, code, killed: false };
}

describe("PI Coffee V5 tool adapters", () => {
  it("keeps the frozen base counts and fails closed when Full tools are absent", () => {
    expect(SIMPLE_TOOLS).toHaveLength(8);
    expect(FULL_TOOLS).toHaveLength(10);
    const table = resolveToolTable("full", SIMPLE_TOOLS);
    expect(table.ready).toBe(false);
    expect(table.missing).toEqual(["git", "verify"]);
  });

  it("keeps native git status/diff observable and leaves snapshots to the VM owner", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run: NativeCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "status") return result("## main\n M src/index.ts\n");
      if (args[0] === "diff") return result("diff --git a/src/index.ts b/src/index.ts\n-old\n+new\n");
      return result();
    };
    const tool = createNativeGitTool({ run });
    const status = await tool.execute("status", { action: "status" } as never, undefined, undefined, context("/workspace"));
    expect(status.content[0].text).toContain("src/index.ts");
    const diff = await tool.execute("diff", { action: "diff" } as never, undefined, undefined, context("/workspace"));
    expect(diff.content[0].text).toContain("+new");
    const checkpoint = await tool.execute("checkpoint", { action: "checkpoint" } as never, undefined, undefined, context("/workspace"));
    expect(checkpoint.content[0].text).toContain("not-supported");
    expect(calls.map((call) => call.args[0])).toEqual(["status", "diff", "diff"]);
  });

  it("uses a resolved path for native worktree registration", async () => {
    let invocation: { command: string; args: string[] } | undefined;
    const run: NativeCommandRunner = async (command, args) => {
      invocation = { command, args };
      return result("Preparing worktree\n");
    };
    const tool = createNativeGitTool({ run });
    await tool.execute(
      "worktree",
      { action: "worktree", op: "register", path: "../task-wt" } as never,
      undefined,
      undefined,
      context("/workspace"),
    );
    expect(invocation).toEqual({
      command: "git",
      args: ["worktree", "add", "--detach", "/task-wt", "HEAD"],
    });
  });

  it("runs quick verification in the User VM and records a bounded state", async () => {
    const state = createMemoryVerifyState("quick");
    const calls: string[] = [];
    const run: NativeCommandRunner = async (command, args, options) => {
      calls.push(`${command} ${args.join(" ")} @ ${options.cwd}`);
      return result("1 passing\n");
    };
    const persisted: Array<{ cwd: string; state: VerifyWorkspaceState }> = [];
    const runResult = await executeProfile("/workspace", state, (cwd, next) => persisted.push({ cwd, state: next }), run, undefined);
    expect(runResult.overall).toBe("not_run");
    expect(calls).toEqual([]); // no config is present in this fixture
    expect(persisted).toHaveLength(1);
    const tool = createNativeVerifyTool({ run, state });
    const tdd = await tool.execute("tdd", { action: "tdd_complete" } as never, undefined, undefined, context("/workspace"));
    expect(tdd.content[0].text).toContain("not-supported");
  });
});
