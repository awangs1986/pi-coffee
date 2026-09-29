import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { digestToolSchema, type ToolSchemaLike } from "./schema-budget.js";
import type { ToolRegistrar } from "./catalog.js";

/**
 * Adapter for Pi's registry. Pi extensions register executable definitions at
 * load time; discovery keeps them inactive, and this Adapter verifies the
 * manifest schema before the catalog appends it to the next request.
 */
export function createPiToolRegistrar(pi: ExtensionAPI): ToolRegistrar {
  return {
    isRegistered: (name) => pi.getAllTools().some((tool) => tool.name === name),
    register: (schema) => {
      const tool = pi.getAllTools().find((candidate) => candidate.name === schema.name);
      if (tool === undefined) throw new Error(`tool '${schema.name}' is not registered by a loaded Pi extension`);
      const actual: ToolSchemaLike = { name: tool.name, description: tool.description, parameters: tool.parameters };
      if (digestToolSchema(actual) !== digestToolSchema(schema)) {
        throw new Error(`schema mismatch for '${schema.name}'; reload the matching extension manifest`);
      }
    },
    // Pi 0.84 has no unregisterTool action. Removing a name from the pending
    // activation set is still useful compensation; the tool remains inactive
    // and therefore absent from the model schema until explicitly activated.
    unregister: () => undefined,
  };
}
