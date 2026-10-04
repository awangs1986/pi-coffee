/** Public API for independent Pi extensions. No executor or Host implementation is exposed. */
export { default, createHarnessExtension } from "./extension.js";
export type { HarnessExtensionOptions } from "./extension.js";
export { registerChatTools } from "./chat-tools.js";
export { currentHarnessMode } from "./runtime-mode.js";
export { registerCapabilityManifest } from "../capabilities/registry.js";
export type { CapabilityRegistration } from "../capabilities/registry.js";
export type { CapabilityManifest, CapabilityReadiness } from "../capabilities/catalog.js";
export type { HarnessMode } from "./mode.js";

export type { ContextBreakdown, ContextCategoryId } from "../context/usage-contract.js";
