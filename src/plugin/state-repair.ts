// Only bounded, validator-checked field changes are admitted.
import { validate, bytes, selectSources, type Source, type TaskState } from './task-state.js';
import { READ_ONLY_ACTIONS } from './grounding.js';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { registerPolicy } from './config.js';
type Generation = ReturnType<ReturnType<typeof registerPolicy>['generation']>;

const systemPrompt = `PI_HANDOFF_FIELD_PATCH
The Task State validator rejected the supplied candidate. Return JSON with EXACTLY two keys: exactValueSplits and stepChanges. Each is an array of CHANGED indexes only. Do not copy whole records, long quotations, the rest of Task State, markdown or commentary.
exactValueSplits entries have only index, label and separator. The program preserves field, value, source and quote. quote must equal label + separator + existing value. A nonempty label needs a separator containing a NON-WHITESPACE character. For quote "Its official language is English" and value "English", use label "Its official language" and separator " is ".
stepChanges entries have only index, phase and status. The program preserves id, text, action, target and authorization. Examine EVERY step. A step whose phase is after_handoff cannot be completed by evidence that exists before this Handoff: change it to status pending. The program clears its completion and sets nextAction to the first pending step. Only read-only evidence steps (action search_evidence or read_evidence) may change from completed to pending; side-effect steps must never be reopened. A pending step cannot keep phase before_handoff: use after_handoff or anytime as the original user authorization indicates.
Use candidate and original sources. If no safe patch exists, return {"exactValueSplits":[],"stepChanges":[]}.`;

export async function repairTaskState(candidate: TaskState, originals: Source[], firstError: unknown, ctx: ExtensionContext, generation: Generation, signal: AbortSignal) {
  if (!ctx.model) throw Error("Handoff repair requires a selected model");
  const validationErrors = [String(firstError)];
  try { validate({ ...structuredClone(candidate), exactValues: [] }, originals); }
  catch (error) {
    if (!validationErrors.includes(String(error))) validationErrors.push(String(error));
  }
  const maxTokens = Math.min(8192, generation.outputTokens);
  const selected = selectSources(originals, Math.min(94000,
    ctx.model.contextWindow - bytes(systemPrompt) - maxTokens - bytes(candidate) - 12000));
  const input = JSON.stringify({validationErrors,
    candidate, sources:selected.selected, coverage:selected.coverage});
  if (bytes(input) > 98304 ||
      bytes(input) + bytes(systemPrompt) + maxTokens + 8192 > ctx.model.contextWindow)
    throw Error('Handoff field repair exceeds preparation input budget');
  const response = await ctx.modelRegistry.streamSimple(ctx.model, {
    systemPrompt,
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  }, { maxTokens,
    reasoning: generation.reasoning, signal }).result();
  if (signal.aborted) throw Error('Handoff repair deadline or cancellation');
  if (response.stopReason !== 'stop')
    throw Error(`Handoff field repair did not finish: ${response.stopReason}`);
  const content = response.content.filter(c => c.type === 'text')
    .map(c => c.text).join('').trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(content);
  const patch = JSON.parse(fenced ? fenced[1] : content);
  if (!Array.isArray(patch.exactValueSplits) || !Array.isArray(patch.stepChanges) ||
      Object.keys(patch).length !== 2)
    throw Error('Invalid Handoff field-patch shape');
  const fixed = structuredClone(candidate);
  const exactSeen = new Set(), stepSeen = new Set();
  for (const part of patch.exactValueSplits) {
    if (!Number.isInteger(part.index) || part.index < 0 ||
        part.index >= fixed.exactValues.length || exactSeen.has(part.index) ||
        Object.keys(part).sort().join(',') !== 'index,label,separator' ||
        typeof part.label !== 'string' || typeof part.separator !== 'string')
      throw Error('Invalid exact-value field patch');
    exactSeen.add(part.index);
    fixed.exactValues[part.index].label = part.label;
    fixed.exactValues[part.index].separator = part.separator;
  }
  for (const part of patch.stepChanges) {
    if (!Number.isInteger(part.index) || part.index < 0 ||
        part.index >= fixed.steps.length || stepSeen.has(part.index) ||
        Object.keys(part).sort().join(',') !== 'index,phase,status' ||
        !['before_handoff', 'after_handoff', 'anytime'].includes(part.phase) ||
        !['pending', 'completed', 'uncertain'].includes(part.status))
      throw Error('Invalid step field patch');
    stepSeen.add(part.index);
    const before = candidate.steps[part.index];
    if (before.status !== part.status) {
      // Structural rule: only read-only evidence work may be reopened.
      if (before.status !== 'completed' || part.status !== 'pending' ||
          !READ_ONLY_ACTIONS.includes(before.action ?? 'other'))
        throw Error('Only a completed read-only evidence step may return to pending');
      fixed.steps[part.index].completion = [];
    }
    fixed.steps[part.index].phase = part.phase;
    fixed.steps[part.index].status = part.status;
  }
  const firstPending = fixed.steps.find(step => step.status === 'pending');
  if (fixed.status === 'active' && firstPending && fixed.nextAction !== firstPending.text) {
    const oldAction = fixed.nextAction;
    fixed.nextAction = firstPending.text;
    for (const claim of fixed.claims)
      if (claim.kind === 'nextAction' && claim.text === oldAction)
        claim.text = firstPending.text;
  }
  return validate(fixed, originals);
}
