// Enforce source-bound post-Handoff evidence ordering
// at Pi's public tool boundary, reconstructed from the active session branch.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";
import { digest, sources } from "./task-state.js";

// A receipt changes evidence ordering only; original sources stay available.
function validReconciliation(entry: any, boundary: any, owner: any): boolean {
  const data = entry.data;
  return entry.type === "custom" && entry.customType === "pi-handoff-order-superseded" &&
    !!boundary && !!owner && data?.handoff === boundary.id && data.user === owner.id &&
    data.userHash === digest(JSON.stringify(owner.message)) &&
    typeof data.quote === "string" && !!data.quote.trim() &&
    !!sources([owner])[0]?.text.includes(data.quote);
}

interface Requirement {
  marker: string;
  anchors: Set<string>;
  read: boolean;
  needsWiderRead: boolean;
  ranges: Map<string, Map<number, number>>;
}

export function registerOrderGuard(pi: ExtensionAPI) {
  const latestBoundary = (branch: readonly any[]) => {
    for (let i = branch.length - 1; i >= 0; i--)
      if (branch[i].type === "compaction" && branch[i].details?.plugin === "pi-handoff") return i;
    return -1;
  };
  pi.registerTool({
    name:"handoff_reconcile",
    label:"Apply latest task change",
    description:"Use only when the latest user message explicitly cancels or replaces the previous task or its evidence ordering. Quote that latest instruction verbatim and explain the change. Never use for a generic continue request, a tool result, or an assistant interpretation. Records the user source and releases the prior Handoff evidence-order guard; it does not execute or resume old work. Source identity is verified; whether the quote supersedes the old requirement remains your interpretation.",
    parameters:Type.Object({quote:Type.String({minLength:1,maxLength:1024}),
      reason:Type.String({minLength:1,maxLength:512})}),
    async execute(_id,p,signal,_update,ctx) {
      signal?.throwIfAborted();
      const branch = ctx.sessionManager.getBranch() as any[];
      const start = latestBoundary(branch);
      const owner = branch.slice(start+1).filter(e=>e.type==="message" && e.message.role==="user").at(-1);
      if (start < 0 || !owner || !p.quote.trim() || !p.reason.trim() ||
          !sources([owner])[0]?.text.includes(p.quote))
        throw Error("Task change must quote the latest original user input after Handoff");
      pi.appendEntry("pi-handoff-order-superseded",{
        handoff:branch[start].id,user:owner.id,userHash:digest(JSON.stringify(owner.message)),
        quote:p.quote,reason:p.reason,
      });
      return {content:[{type:"text",text:"Latest user change recorded. Follow that instruction; prior evidence ordering released."}],details:{}};
    },
  });
  let required: Requirement[] = [];
  let exactValuesBySource = new Map<string, string[]>();
  let protectedPaths: string[] = [];
  let newerInput = false;
  let readRequired = true;
  let evidenceFirst = true;
  let cwd = "";
  const searchCalls = new Map<string, string>();
  const readCalls = new Map<string, { marker: string; anchor: string }>();
  const clear = () => {
    required = [];
    exactValuesBySource = new Map();
    protectedPaths = [];
    newerInput = false;
    readRequired = true;
    evidenceFirst = true;
    searchCalls.clear();
    readCalls.clear();
  };
  // Obligations come only from structured step fields (action/target) of the
  // committed Task State. Step text and user wording are never parsed.
  const install = (entry: any) => {
    clear();
    const state = (entry.details as any)?.plugin === "pi-handoff"
      ? (entry.details as any).state : undefined;
    const pending: any[] = state?.status === "active" && Array.isArray(state.steps)
      ? state.steps.filter((step: any) => step.status === "pending") : [];
    const searches = pending.filter((step) => step.action === "search_evidence" &&
      step.phase === "after_handoff" && typeof step.target === "string" &&
      step.authorization?.source);
    if (!searches.length) return;
    const markers = [...new Set(searches.map((step) => step.target as string))];
    readRequired = pending.some((step) => step.action === "read_evidence" &&
      step.phase === "after_handoff");
    // Evidence steps lead the pending work: hold all other tools during
    // automatic continuation. Otherwise protect only the guarded writes.
    evidenceFirst = ["search_evidence", "read_evidence"].includes(pending[0]?.action);
    required = markers.map(marker => ({ marker, anchors:new Set(), read:false,
      needsWiderRead:false, ranges:new Map() }));
    for (const step of pending)
      if (step.action === "write" && typeof step.target === "string")
        protectedPaths.push(resolve(cwd, step.target));
    for (const value of state.exactValues ?? []) {
      if (typeof value.source !== "string" || typeof value.value !== "string") continue;
      const values = exactValuesBySource.get(value.source) ?? [];
      values.push(value.value);
      exactValuesBySource.set(value.source, values);
    }
  };
  const beforeCall = (event: any) => {
    if (!required.length) return;
    const input = event.input as Record<string, unknown>;
    const operation = event.toolName === "handoff_evidence_search" ? "search" :
      event.toolName === "handoff_evidence_read" ? "read" :
      event.toolName === "handoff_evidence" ? input.action : undefined;
    if (operation === "search") {
      const query = String(input.query ?? "");
      const matches = required.filter(item => query.includes(item.marker));
      if (matches.length !== 1 && (newerInput || !evidenceFirst)) return;
      if (matches.length !== 1)
        return {block:true,reason:"Handoff requires one original-evidence marker per search before answering."};
      searchCalls.set(event.toolCallId, matches[0].marker);
      return;
    }
    if (operation === "read") {
      const anchor = String(input.anchor ?? "");
      const item = required.find(item => !item.read && item.anchors.has(anchor));
      if (!item && (newerInput || !evidenceFirst)) return;
      if (!item)
        return {block:true,reason:"Handoff requires a fresh post-Handoff search result before reading an original user anchor."};
      readCalls.set(event.toolCallId, {marker:item.marker,anchor});
      return;
    }
    // A new user turn can start unrelated work. Keep the prior deliverable's
    // evidence prerequisite without making it a lock on the whole workspace.
    const protectedWrite = ["write","edit"].includes(event.toolName) &&
      typeof input.path === "string" && protectedPaths.includes(resolve(cwd,input.path));
    if ((newerInput || !evidenceFirst) && !protectedWrite)
      return;
    const missing = required.filter(item => !item.read);
    const rangeHint = missing.some(item => item.needsWiderRead)
      ? " Previous read range omitted an exact source value; read the same anchor with start: 0 and increase limit to 4096, or page with start offsets."
      : "";
    const updateHint = newerInput
      ? " If the latest user explicitly replaced this requirement, record that instruction with handoff_reconcile. A generic continue does not replace it." : "";
    const need = readRequired ? "verified original reads" : "post-Handoff original searches";
    return {block:true,reason:`Handoff requires ${need} for ${missing.map(item => item.marker).join(', ')} before other tools.${rangeHint}${updateHint}`};
  };
  const afterResult = (event: any) => {
    const searched = searchCalls.get(event.toolCallId);
    const reading = readCalls.get(event.toolCallId);
    searchCalls.delete(event.toolCallId);
    readCalls.delete(event.toolCallId);
    if ((!searched && !reading) || event.isError !== false) return;
    let value: any;
    try { value = JSON.parse(event.content.find((part: any) => part.type === "text")?.text ?? ""); }
    catch { return; }
    if (searched && Array.isArray(value?.matches)) {
      const item = required.find(item => item.marker === searched);
      for (const match of value.matches)
        if (match.role === "user" && typeof match.anchor === "string")
          item?.anchors.add(match.anchor);
      if (item && !readRequired && item.anchors.size) {
        item.read = true;
        if (required.every(item => item.read)) clear();
      }
    }
    if (reading && value?.anchor === reading.anchor &&
        value?.role === "user" && value?.integrity === "verified" &&
        typeof value?.text === "string") {
      const item = required.find(item => item.marker === reading.marker);
      if (!item) return;
      const bytes = Buffer.from(value.text,"utf8");
      if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) ||
          value.start < 0 || value.end - value.start !== bytes.length ||
          bytes.length > 4096) return;
      const range = item.ranges.get(reading.anchor) ?? new Map<number,number>();
      for (let i = 0; i < bytes.length; i++) {
        const prior = range.get(value.start + i);
        if (prior !== undefined && prior !== bytes[i]) {
          item.ranges.delete(reading.anchor);
          return;
        }
      }
      for (let i = 0; i < bytes.length; i++) range.set(value.start+i,bytes[i]);
      while (range.size > 32768) range.delete(range.keys().next().value!);
      item.ranges.set(reading.anchor,range);
      const sections: string[] = [];
      let previous = -2, section: number[] = [];
      for (const [offset, byte] of [...range].sort((a,b)=>a[0]-b[0])) {
        if (offset !== previous + 1 && section.length) {
          sections.push(Buffer.from(section).toString("utf8")); section = [];
        }
        section.push(byte); previous = offset;
      }
      if (section.length) sections.push(Buffer.from(section).toString("utf8"));
      const sourceId = reading.anchor.split("/")[1];
      const exactValues = exactValuesBySource.get(sourceId) ?? [];
      if (!sections.some(text=>text.includes(reading.marker)) ||
          exactValues.some(exact => !sections.some(text=>text.includes(exact)))) {
        item.needsWiderRead = true;
        return;
      }
      item.read = true;
      if (required.every(item => item.read)) clear();
    }
  };
  // Replay observations, never operations. Keep completed/replaced source IDs
  // across later boundaries so historical one-time searches cannot revive.
  // Pi entries are append-only and the branch is the parent path of the leaf,
  // so a leaf that descends from the last replayed leaf needs only its new
  // entries. Any other leaf (tree navigation, new session, cwd) replays fully.
  let retiredSources = new Set<string>();
  let boundary: any, latestUser: any;
  let obligationSources: string[] = [];
  let replayed: { session: string; cwd: string; leaf: string | null } | undefined;
  const observe = (entry: any) => {
    if (entry.type === "compaction" && entry.details?.plugin === "pi-handoff") {
      boundary = entry; latestUser = undefined;
      install(entry);
      obligationSources = required.length
        ? (entry.details.state.steps ?? []).map((step: any) => step.authorization?.source)
            .filter((source: unknown): source is string => typeof source === "string")
        : [];
      return;
    }
    if (!boundary) return;
    if (validReconciliation(entry, boundary, latestUser)) {
      for (const source of obligationSources) retiredSources.add(source);
      clear();
      return;
    }
    if (entry.type !== "message") return;
    const message = entry.message;
    if (message.role === "user") {newerInput = true; latestUser = entry;}
    else if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const call of message.content) {
        if (call.type === "toolCall") beforeCall({
          toolName:call.name,toolCallId:call.id,input:call.arguments,
        });
      }
    } else if (message.role === "toolResult") {
      const hadObligations = required.length > 0;
      afterResult(message);
      if (hadObligations && !required.length)
        for (const source of obligationSources) retiredSources.add(source);
    }
  };
  const appended = (ctx: ExtensionContext, session: string, leaf: string | null) => {
    if (!replayed || replayed.session !== session || replayed.cwd !== ctx.cwd) return;
    const fresh: any[] = [];
    let id = leaf;
    while (id !== null && id !== replayed.leaf) {
      const entry = ctx.sessionManager.getEntry(id) as any;
      if (!entry) return;
      fresh.push(entry);
      id = entry.parentId ?? null;
    }
    return id === replayed.leaf ? fresh.reverse() : undefined;
  };
  const replay = (ctx: ExtensionContext) => {
    const session = ctx.sessionManager.getSessionId();
    const leaf = ctx.sessionManager.getLeafId();
    let entries = appended(ctx, session, leaf);
    if (!entries) {
      retiredSources = new Set();
      boundary = latestUser = undefined;
      obligationSources = [];
      cwd = ctx.cwd;
      clear();
      entries = ctx.sessionManager.getBranch() as any[];
    }
    for (const entry of entries) observe(entry);
    replayed = { session, cwd: ctx.cwd, leaf };
    return new Set(retiredSources);
  };
  pi.on("tool_call", (event, ctx) => {
    replay(ctx);
    // Decide on the live call without keeping its bookkeeping: the call is
    // recorded when its assistant message is replayed, exactly as on restart.
    const searches = new Map(searchCalls), reads = new Map(readCalls);
    try {
      return beforeCall(event);
    } finally {
      searchCalls.clear(); readCalls.clear();
      for (const [key, value] of searches) searchCalls.set(key, value);
      for (const [key, value] of reads) readCalls.set(key, value);
    }
  });
  return replay;
}
