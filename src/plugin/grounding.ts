import type { Source } from "./task-state.js";

export interface ExactValue {
  field: string;
  label: string;
  separator: string;
  value: string;
  source: string;
  quote: string;
  hash: string;
  timestamp: string;
}

function shortText(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function exactValues(value: unknown, originals: Source[]): ExactValue[] {
  // Legacy states have no exact-value coverage; absence is not a fidelity claim.
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16)
    throw new Error("Invalid exact-value records");
  const fields = new Set<string>();
  return value.map((record) => {
    if (!record || !shortText(record.field, 80) || fields.has(record.field) ||
        !shortText(record.value) || !shortText(record.quote, 1024) ||
        typeof record.label !== "string" || record.label.length > 128 ||
        typeof record.separator !== "string" || record.separator.length > 8)
      throw new Error("Invalid exact-value record");
    const source = originals.find((s) => s.id === record.source);
    if (!source || !source.text.includes(record.quote))
      throw new Error("Exact value requires an original source quotation");
    // Do not guess a generic delimiter or silently strip characters from an ID.
    // A labeled span must be reconstructed exactly from its separate components.
    if ((!record.label && record.separator) ||
        (record.label && !record.separator.trim()) ||
        record.quote !== record.label + record.separator + record.value)
      throw new Error("Exact value includes its label or differs from the quoted value");
    fields.add(record.field);
    return {
      field: record.field, label: record.label, separator: record.separator,
      value: record.value, source: source.id, quote: record.quote,
      hash: source.hash, timestamp: source.timestamp,
    };
  });
}

interface BoundQuote {
  source: string;
  quote: string;
  hash: string;
  timestamp: string;
}
/**
 * Structured step action. The program enforces evidence ordering from these
 * fields, never from the natural-language step text or the user's wording.
 */
export type StepAction = "search_evidence" | "read_evidence" | "write" | "other";
export const STEP_ACTIONS: readonly StepAction[] = ["search_evidence", "read_evidence", "write", "other"];
export const READ_ONLY_ACTIONS: readonly StepAction[] = ["search_evidence", "read_evidence"];
export interface ProcedureStep {
  id: string;
  text: string;
  action: StepAction;
  /** search_evidence: exact query; write: workspace path; otherwise optional. */
  target?: string;
  phase: "before_handoff" | "after_handoff" | "anytime";
  status: "pending" | "completed" | "uncertain";
  authorization: BoundQuote;
  completion: BoundQuote[];
}

export function procedureSteps(value: unknown, originals: Source[], status: string, nextAction: string): ProcedureStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12)
    throw new Error("Invalid procedure steps");
  const ids = new Set<string>();
  const bind = (ref: any, role: "user" | "toolResult"): BoundQuote => {
    const source = originals.find((s) => s.id === ref?.source);
    if (!source || source.role !== role || !shortText(ref?.quote, 1024) ||
        !source.text.includes(ref.quote) ||
        (role === "toolResult" && !source.successfulToolResult))
      throw new Error("Procedure requires original authorization and successful tool completion evidence");
    return { source: source.id, quote: ref.quote, hash: source.hash, timestamp: source.timestamp };
  };
  const steps = value.map((step): ProcedureStep => {
    if (!step || !shortText(step.id, 80) || ids.has(step.id) || !shortText(step.text) ||
        !["before_handoff", "after_handoff", "anytime"].includes(step.phase) ||
        !["pending", "completed", "uncertain"].includes(step.status) ||
        !Array.isArray(step.completion) || step.completion.length > 4)
      throw new Error("Invalid procedure step");
    ids.add(step.id);
    // Legacy steps without an action are unstructured and receive no ordering guard.
    const action: StepAction = step.action === undefined ? "other" : step.action;
    if (!STEP_ACTIONS.includes(action) ||
        (step.target !== undefined && !shortText(step.target, 256)))
      throw new Error("Invalid procedure step action");
    if ((action === "search_evidence" || action === "write") && step.target === undefined)
      throw new Error(`A ${action} step requires a target`);
    if (step.target !== undefined && action !== "other") {
      // Source-bound: a guarded query or path must occur in the authorizing
      // original user message. This is lexical and language-independent.
      const owner = originals.find((s) => s.id === step.authorization?.source);
      if (!owner || owner.role !== "user" || !owner.text.includes(step.target))
        throw new Error("Step target must occur in its original user authorization");
    }
    if (step.status === "completed" && (step.phase === "after_handoff" || !step.completion.length))
      throw new Error("A post-Handoff step cannot be completed by pre-Handoff evidence");
    if (step.status !== "completed" && step.completion.length)
      throw new Error("Unfinished steps cannot carry completion evidence");
    if (step.phase === "before_handoff" && step.status !== "completed")
      throw new Error("Required pre-Handoff work remains unfinished");
    return {
      id: step.id, text: step.text, action,
      ...(step.target !== undefined ? { target: step.target } : {}),
      phase: step.phase, status: step.status,
      authorization: bind(step.authorization, "user"),
      completion: step.completion.map((ref: any) => bind(ref, "toolResult")),
    };
  });
  const pending = steps.filter((s) => s.status !== "completed");
  if (status === "done" && pending.length)
    throw new Error("Completed task still has unfinished procedure steps");
  if (status === "active" && steps.length &&
      (!pending.length || pending.some((s) => s.status === "uncertain") || nextAction !== pending[0].text))
    throw new Error("Active next action must match the first pending procedure step");
  return steps;
}
