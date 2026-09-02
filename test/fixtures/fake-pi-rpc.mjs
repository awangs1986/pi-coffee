import readline from "node:readline";

let messageCount = 0;
let streaming = false;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function response(command, id, data = {}) {
  send({ id, type: "response", command, success: true, data });
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
    case "prompt": {
      response("prompt", command.id);
      setImmediate(() => {
        streaming = true;
        send({ type: "agent_start" });
        send({
          type: "message_update",
          usage: {},
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${command.message}` },
        });
        messageCount += 2;
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
