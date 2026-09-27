/** Public integration surface for Pi consumers; transport and task ownership stay outside this package. */
export { resolvePiExtensions } from "./pi-extensions.js";
export { resolvePiSkills, withCoffeeLspPath } from "./pi-skills.js";
export { stopLspDaemon } from "./lsp/transport.js";
export type { ContextBreakdown, ContextCategoryId } from "./context/usage-contract.js";
