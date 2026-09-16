import { pendingNativeRuns } from "./workspace-jobs.js";
import { subagentsAllowed } from "../harness/runtime-mode.js";
import { createJiti } from "jiti/static";
import * as piRuntime from "@earendil-works/pi-coding-agent";
import * as agentCore from "@earendil-works/pi-agent-core";
import * as aiCompat from "@earendil-works/pi-ai/compat";
import * as tui from "@earendil-works/pi-tui";
import { createRequire } from "node:module";
import { Type } from "typebox";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCapabilityManifest } from "../capabilities/registry.js";
import { readGlobalSubagentModel } from "./model-policy.js";
import { boundSubagentResult } from "./result-artifact.js";
import { configureAdmission, childProcesses } from "./admission.js";

const require = createRequire(import.meta.url);
const taskSchema = Type.Object({ agent: Type.String(), task: Type.String({ maxLength: 16000 }), model: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()) });

/** Small model-facing surface; execution, background tracking and cancellation stay upstream. */
export function boundedSubagentTool(tool: ToolDefinition, supervisor?: () => ToolDefinition | undefined): ToolDefinition {
  if (tool.name === "bg_wait") return { ...tool,
    description: "Wait for non-notifying background work. Ordinary subagents notify completion; use returned run IDs, not polling loops.",
    parameters: Type.Object({ id: Type.Optional(Type.String()), all: Type.Optional(Type.Boolean()), timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 600000 })) }),
  };
  return { ...tool,
    description: "Delegate focused work to native Pi children. Prefer delegation for research/search and independent investigation. List agents first. Supply agent/task for one child, or tasks for a batch. Fresh context; no recursive delegation. Maximum running: 3 per root conversation, 5 per VM; excess queues. Return concise findings and artifact/source indexes. Use action=pending/reply for child supervisor requests. Model can be set per child; /subagents-model sets your default.",
    promptSnippet: "Use subagents for research or independent tasks; keep raw evidence out of the parent context.",
    promptGuidelines: ["Use action=list before choosing an agent. Do not run concurrent writers in the same cwd. Consume completion before dependent work."],
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("models"), Type.Literal("status"), Type.Literal("stop"), Type.Literal("pending"), Type.Literal("reply")])),
      message: Type.Optional(Type.String({ maxLength: 4000 })), replyTo: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()), agent: Type.Optional(Type.String()), task: Type.Optional(Type.String({ maxLength: 16000 })),
      tasks: Type.Optional(Type.Array(taskSchema, { minItems: 1, maxItems: 12 })), model: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()), async: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    async execute(id, raw, signal, update, ctx) {
      if (process.env.PI_SUBAGENT_CHILD === "1") throw new Error("Nested delegation is disabled; return work to the root agent.");
      const input = raw as any;
      if (["pending", "reply"].includes(input.action)) {
        const handler = supervisor?.();
        if (!handler) throw new Error("Native supervisor is not ready");
        return handler.execute(id, { action: input.action, message: input.message, replyTo: input.replyTo } as never, signal, update, ctx);
      }
      if (input.action) {
        if (!["list", "get", "models", "status", "stop"].includes(input.action)) throw new Error("Unsupported subagent action");
        if (input.task || input.tasks) throw new Error("Do not combine management and execution");
        return tool.execute(id, { action: input.action, id: input.id, agent: input.agent } as never, signal, update, ctx);
      }
      const common = { async: input.async ?? true, context: "fresh", cwd: input.cwd ?? ctx.cwd, model: input.model ?? (input.agent === "coffee-research" ? await readGlobalSubagentModel() : undefined) };
      if (input.tasks) {
        if (input.agent || input.task || !Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 12) throw new Error("Use one child or a batch of 1–12 tasks");
        const researchModel = await readGlobalSubagentModel();
        const tasks = input.tasks.map((item: any, i: number) => {
          if (!item.agent || !item.task) throw new Error("Each task needs agent and task");
          return { key: `task-${i}`, agent: item.agent, task: item.task, model: item.model ?? input.model ?? (item.agent === "coffee-research" ? researchModel : undefined), cwd: item.cwd ?? common.cwd, context: "fresh" };
        });
        return tool.execute(id, { ...common, globalConcurrencyLimit: 3,
          workflowScript: `const children = await runs.all(${JSON.stringify(tasks)}); return children;`,
        } as never, signal, update, ctx);
      }
      if (!input.agent || !input.task) throw new Error("Specify agent and task, or tasks");
      return tool.execute(id, { ...common, agent: input.agent, task: input.task } as never, signal, update, ctx);
    },
  };
}

export default async function nativeAdapter(pi: ExtensionAPI): Promise<void> {
  configureAdmission();
  const inheritedRoot = process.env.PI_COFFEE_ROOT_SESSION;
  pi.on("session_start", (_event, ctx) => {
    if (process.env.PI_SUBAGENT_CHILD !== "1") process.env.PI_COFFEE_ROOT_SESSION = inheritedRoot ?? ctx.sessionManager.getSessionId();
  });
  const tools: ToolDefinition[] = [];
  let supervisor: ToolDefinition | undefined;
  let statusTool: ToolDefinition | undefined;
  const api = new Proxy(pi, {
    get(target, key, receiver) {
      if (key === "setActiveTools") return (names: string[]) => target.setActiveTools(names.filter(name => name !== "subagent_supervisor"));
      if (key === "sendMessage") return (message: any, options: any) => {
        if (!["subagent-notify", "subagent_supervisor_request"].includes(message.customType)) return target.sendMessage(message, options);
        const bounded = boundSubagentResult(message.content, message.details);
        return target.sendMessage({ ...message, ...bounded }, options);
      };
      if (key === "registerCommand") return (name: string, command: any) => target.registerCommand(name, {
        ...command, async handler(args: string, ctx: any) {
          if (!subagentsAllowed(pi)) { ctx.ui.notify("Subagents are disabled in Simple/Lean; use /harness full first.", "warning"); return; }
          return command.handler(args, ctx);
        },
      });
      if (key === "registerTool") return (tool: ToolDefinition) => {
        if(tool.name==="subagent")statusTool=tool;
        if (tool.name === "subagent_supervisor") { supervisor = tool; return; }
        const adapted = ["subagent", "bg_wait"].includes(tool.name) ? boundedSubagentTool(tool, () => supervisor) : tool;
        const execute = adapted.execute;
        const guarded: ToolDefinition = { ...adapted, async execute(...args) {
          if (!subagentsAllowed(pi)) throw new Error("Subagents are disabled in Simple/Lean; use /harness full first.");
          const result = await execute(...args);
          return { ...result, ...boundSubagentResult(result.content, result.details) };
        } };
        tools.push(guarded); target.registerTool(guarded);
      };
      return Reflect.get(target, key, receiver);
    },
  });
  const module = await createJiti(import.meta.url, { moduleCache: false, virtualModules: {
    "@earendil-works/pi-coding-agent": piRuntime,
    "@earendil-works/pi-agent-core": agentCore,
    "@earendil-works/pi-ai": aiCompat,
    "@earendil-works/pi-ai/compat": aiCompat,
    "@earendil-works/pi-tui": tui,
  } }).import(require.resolve("pi-subagents"), { default: true });
  const factory = (module as { default?: unknown }).default ?? module;
  if (typeof factory !== "function") throw new Error("pi-subagents extension entry is unavailable");
  await factory(api);
  const bundle = tools.filter(tool => ["subagent", "bg_wait"].includes(tool.name));
  if (bundle.length !== 2) throw new Error("Native subagent tool contract is incomplete");
  registerCapabilityManifest(pi, {
    manifest: { id: "subagent", kind: "pi-extension", origin: "suite", title: "Native subagents", summary: "Delegate research and independent tasks; 3 per conversation, 5 per VM, excess queues", keywords: ["subagent", "delegate", "research", "search", "parallel"],
      tools: bundle.map(({ name, description, parameters }) => ({ name, description, parameters })),
      supportedHarness: ["full"], permissionSummary: "Native children run in the user VM; admission is resource scheduling, not a sandbox", runnerConformance: "passed" },
    initialTrust: "trusted", conformanceSource: "local",
  });
  pi.registerCommand("coffee-workspace-jobs", {description:"Host read-only lifecycle check; does not launch a child", handler:async(args,ctx)=>{
    const nonce=args.trim();if(!/^[a-f0-9-]{36}$/.test(nonce))throw new Error("Invalid lifecycle query");
    let known=false, active=0;
    try {
      const result=await statusTool!.execute(nonce,{action:"status",view:"fleet"} as never,undefined,undefined,ctx);
      const used=(result.details as any)?.activeAsyncCapacity?.used;
      const processes=childProcesses(process.env.PI_COFFEE_ROOT_SESSION ?? ctx.sessionManager.getSessionId());
      known=!(result as any).isError && Number.isSafeInteger(used) && used>=0 && processes.known;
      active=Math.max(typeof used==="number" ? used : 0,processes.active,pendingNativeRuns(ctx.sessionManager.getEntries()));
    }catch {known=false;}
    pi.appendEntry("coffee-workspace-jobs",{nonce,known,active,at:Date.now()});
  }});
  // A real loaded-state marker for search dispatch and diagnosis.
  pi.registerCommand("subagents-policy", { description: "Show native admission limits", handler: async (_args, ctx) => {
    ctx.ui.notify("Native child admission: 3 per root conversation, 5 per VM; queued launches expire after 10 minutes. No nested children. Independent model: /subagents-model provider/model.", "info");
  } });
}
