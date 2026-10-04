import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChatTools, registeredChatTools } from "../src/harness/chat-tools.js";
import { chatPayload } from "../src/harness/chat-payload.js";
import { resolveToolTable } from "../src/harness/mode.js";

it("independent installed extensions declare optional Chat tools without activating them", () => {
  const events = new EventEmitter();
  const plugin = { events } as unknown as ExtensionAPI;
  const harness = { events, getAllTools: () => ["read", "write", "edit", "bash", "mishu", "unregistered"].map(name => ({ name })) } as unknown as ExtensionAPI;
  registerChatTools(plugin, ["mishu", "missing", "mishu"]);
  const names = registeredChatTools(harness);
  expect(names).toEqual(["mishu"]);
  const available = harness.getAllTools().map(tool => tool.name);
  expect(resolveToolTable("chat", available, [], names).active).not.toContain("mishu");
  expect(resolveToolTable("chat", available, ["mishu", "unregistered"], names).active).toEqual(["read", "edit", "write", "bash", "mishu"]);
  const payload = { messages: [{ role: "system", content: "hidden" }, { role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "mishu" } }, { type: "function", function: { name: "unregistered" } }] };
  expect(chatPayload(payload)).toEqual({ messages: [{ role: "user", content: "hello" }], tools: [] });
  expect(chatPayload(payload, names)).toEqual({ messages: [{ role: "user", content: "hello" }], tools: [payload.tools[0]] });
});
