import readline from "node:readline";

// Stand-in for `pi --mode rpc`. Keeps an append-only entry list shaped like
// Pi's session entries so get_entries / history projection can be exercised
// without a real model. `--session <path>` marks a resumed session by seeding
// one prior exchange, so tests can tell resume from create.
let messageCount = 0;
let streaming = false;
const entries = [];
let nextEntry = 0;
const resumedFrom = process.argv.indexOf("--session") >= 0 ? process.argv[process.argv.indexOf("--session") + 1] : undefined;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function response(command, id, data = {}) {
  send({ id, type: "response", command, success: true, data });
}

function appendEntry(message) {
  const entry = {
    type: "message",
    id: `e${(nextEntry += 1)}`,
    parentId: entries.length === 0 ? null : entries[entries.length - 1].id,
    timestamp: new Date().toISOString(),
    message,
  };
  entries.push(entry);
  messageCount += 1;
  return entry;
}

if (resumedFrom !== undefined) {
  appendEntry({ role: "user", content: [{ type: "text", text: `resumed from ${resumedFrom}` }] });
  appendEntry({ role: "assistant", content: [{ type: "text", text: "welcome back" }] });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const command = JSON.parse(line);
  switch (command.type) {
    case "get_state":
      response("get_state", command.id, {
        isStreaming: streaming,
        isCompacting: false,
        thinkingLevel: "medium",
        steeringMode: "all",
        followUpMode: "one-at-a-time",
        sessionId: "fake-session",
        sessionFile: undefined,
        autoCompactionEnabled: true,
        messageCount,
        pendingMessageCount: 0,
      });
      break;
    case "get_entries": {
      const since = command.since;
      const index = since === undefined ? -1 : entries.findIndex((entry) => entry.id === since);
      response("get_entries", command.id, {
        entries: entries.slice(index + 1),
        leafId: entries.length === 0 ? null : entries[entries.length - 1].id,
      });
      break;
    }
    case "prompt": {
      response("prompt", command.id);
      setImmediate(() => {
        streaming = true;
        send({ type: "agent_start" });
        appendEntry({ role: "user", content: [{ type: "text", text: command.message }] });
        send({
          type: "message_update",
          usage: {},
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${command.message}` },
        });
        const assistant = { role: "assistant", content: [{ type: "text", text: `echo: ${command.message}` }] };
        appendEntry(assistant);
        send({ type: "message_end", message: assistant });
        streaming = false;
        send({ type: "agent_settled" });
      });
      break;
    }
    case "abort":
      response("abort", command.id);
      streaming = false;
      send({ type: "agent_settled" });
      break;
    default:
      response(command.type, command.id);
  }
}
