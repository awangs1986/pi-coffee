import { describe, expect, it } from "vitest";
import { decodeClientFrame, encodeFrame, MAX_FRAME_BYTES } from "../src/shared/protocol.js";

describe("PI Coffee wire protocol", () => {
  it("round-trips a prompt frame through the public codec", () => {
    const frame = {
      v: 1 as const,
      type: "prompt" as const,
      requestId: "req-1",
      text: "hello",
    };

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("rejects frames from a different protocol version", () => {
    expect(() => decodeClientFrame(JSON.stringify({ v: 2, type: "ping", nonce: "x" }))).toThrow(
      /protocol version/i,
    );
  });

  it("rejects oversized frames before parsing them", () => {
    const oversized = `{"v":1,"type":"prompt","requestId":"r","text":"${"x".repeat(MAX_FRAME_BYTES)}"}`;
    expect(() => decodeClientFrame(oversized)).toThrow(/too large/i);
  });

  it("rejects a prompt without a non-empty request id and text", () => {
    expect(() =>
      decodeClientFrame(JSON.stringify({ v: 1, type: "prompt", requestId: "", text: "" })),
    ).toThrow(/requestId|text/i);
  });
});
