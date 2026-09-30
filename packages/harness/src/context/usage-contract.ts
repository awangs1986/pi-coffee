export type ContextCategoryId = "system" | "tools" | "rules" | "skills" | "dynamic" | "subagents" | "conversation";
export interface ContextBreakdown {
  version: 1;
  method: "o200k_base_estimate";
  basis: "last_request" | "session_preview";
  model: string;
  capturedAt: string;
  contextWindow: number;
  totalTokens: number;
  categories: Array<{ id: ContextCategoryId; tokens: number }>;
  mediaOmitted: boolean;
}

