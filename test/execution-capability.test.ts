import { describe, expect, it } from "vitest";
import { inspectExecutionCapability } from "../src/host/execution-capability.js";

describe("VM owner execution capability", () => {
  it("reports the service owner environment and verified passwordless root", async () => {
    const result = await inspectExecutionCapability(async (command, args) => {
      if (command === "id" && args[0] === "-u") return { stdout: "1000\n", stderr: "" };
      if (command === "sudo") return { stdout: "0\n", stderr: "" };
      throw new Error("unexpected probe");
    }, { uid: 1000, home: "/home/alice" });
    expect(result).toEqual({ ownerUid: 1000, serviceUid: 1000, home: "/home/alice", ownerEnvironment: true, passwordlessRoot: true });
  });

  it("does not claim root capability when sudo requires interaction", async () => {
    const result = await inspectExecutionCapability(async (command) => {
      if (command === "id") return { stdout: "1000\n", stderr: "" };
      throw new Error("sudo: a password is required");
    }, { uid: 1000, home: "/home/alice" });
    expect(result.passwordlessRoot).toBe(false);
    expect(result.ownerEnvironment).toBe(true);
  });
});
