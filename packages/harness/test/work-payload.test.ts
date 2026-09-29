import { expect, it } from "vitest";
import { refreshWorkPayload } from "../src/harness/work-payload.js";

const old = "<pi_coffee_harness>old</pi_coffee_harness>";
const updated = "<pi_coffee_harness>active lsp; literal $&</pi_coffee_harness>";
const previous = `PI BASE\n${old}\nOTHER EXTENSION`;
const current = `PI BASE\n${updated}\nOTHER EXTENSION`;

it.each([
  [{ messages: [{ role: "system", content: previous }] }, { messages: [{ role: "system", content: current }] }],
  [{ instructions: previous, input: [{ role: "developer", content: [{ type: "input_text", text: previous }] }] },
    { instructions: current, input: [{ role: "developer", content: [{ type: "input_text", text: current }] }] }],
  [{ system: [{ type: "text", text: previous, cache_control: { type: "ephemeral" } }] },
    { system: [{ type: "text", text: current, cache_control: { type: "ephemeral" } }] }],
  [{ config: { systemInstruction: { parts: [{ text: previous }] }, temperature: 0.5 } },
    { config: { systemInstruction: { parts: [{ text: current }] }, temperature: 0.5 } }],
  [{ system_instruction: { parts: [{ text: previous }] } }, { system_instruction: { parts: [{ text: current }] } }],
])("refreshes owned system text without discarding provider metadata (%#)", (payload, expected) => {
  const snapshot = structuredClone(payload);
  expect(refreshWorkPayload(payload, updated)).toEqual(expected);
  expect(payload).toEqual(snapshot);
});

it("does not change user/tool quotations, schemas, or another extension's system text", () => {
  const payload = {
    messages: [
      { role: "system", content: "custom system without Harness block" },
      { role: "user", content: old },
      { role: "assistant", content: old },
      { role: "tool", content: old },
    ],
    tools: [{ name: "example", description: old }],
  };
  expect(refreshWorkPayload(payload, updated)).toEqual(payload);
});
