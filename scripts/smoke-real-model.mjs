#!/usr/bin/env node
// PI Coffee real-model smoke (MVP-005 acceptance evidence).
//
// Drives the browser-facing WebSocket exactly like the shell does:
//   1. open  -> new Session
//   2. prompt -> wait for streamed text_delta and agent_settled
//   3. disconnect, reconnect with sessionId + after=<older cursor>
//      -> assert bounded replay: only events with cursor > after, no duplicates
//   4. reconnect with after=<latest cursor> -> assert zero replay
//
// Needs a running Web Server (`npm start` or `npm run start:web` + Host) whose
// Host has a real provider configured (see docs/deployment/runbook.md).
// Contains no credentials; it never reads the model key.
//
//   node scripts/smoke-real-model.mjs [ws://127.0.0.1:3000/ws]
//   PI_COFFEE_SMOKE_TIMEOUT_MS=120000  (default 90000)

import WebSocket from "ws";

const url = process.argv[2] ?? process.env.PI_COFFEE_WEB_WS ?? "ws://127.0.0.1:3000/ws";
const timeoutMs = Number(process.env.PI_COFFEE_SMOKE_TIMEOUT_MS ?? 90_000);
const PROMPT = "Reply with exactly the two words: coffee ready";

const evidence = {
  webSocketUrl: url,
  startedAt: new Date().toISOString(),
  steps: [],
  ok: false,
};

function step(name, data) {
  evidence.steps.push({ name, ...data });
  console.log(`[${data.ok === false ? "FAIL" : "ok  "}] ${name}${data.detail ? " — " + data.detail : ""}`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const frames = [];
    const waiters = [];
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      for (const w of [...waiters]) if (w.match(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
    });
    socket.on("open", () => resolve({ socket, frames, waitFor }));
    socket.on("error", reject);
    function waitFor(match, label, ms = timeoutMs) {
      return new Promise((res, rej) => {
        const hit = frames.find(match);
        if (hit) return res(hit);
        const timer = setTimeout(() => rej(new Error(`timeout waiting for ${label}`)), ms);
        waiters.push({ match, resolve: (f) => { clearTimeout(timer); res(f); } });
      });
    }
  });
}

function send(socket, frame) {
  socket.send(JSON.stringify({ v: 1, ...frame }));
}

async function main() {
  // ---- 1. open a fresh session ----
  const a = await connect();
  send(a.socket, { type: "open" });
  const opened = await a.waitFor((f) => f.type === "opened", "opened", 15_000);
  const sessionId = opened.sessionId;
  step("open new session", { ok: true, detail: `sessionId=${sessionId} cursor=${opened.cursor}` });

  // ---- 2. prompt and stream ----
  const t0 = Date.now();
  send(a.socket, { type: "prompt", requestId: "smoke-1", text: PROMPT });
  await a.waitFor((f) => f.type === "ack" && f.requestId === "smoke-1", "prompt ack", 15_000);
  const errorFrame = a.frames.find((f) => f.type === "error");
  if (errorFrame) throw new Error(`error frame after prompt: ${errorFrame.code} ${errorFrame.message}`);

  await a.waitFor((f) => f.type === "event" && f.event?.type === "agent_settled", "agent_settled");
  const events = a.frames.filter((f) => f.type === "event");
  const deltas = events.filter((f) => f.event?.type === "message_update" && f.event.assistantMessageEvent?.type === "text_delta");
  const firstDeltaIndex = a.frames.indexOf(deltas[0]);
  const modelError = events.find((f) => f.event?.type === "message_end" && f.event.message?.stopReason === "error");
  if (modelError) throw new Error(`model error: ${modelError.event.message.errorMessage}`);
  const text = deltas.map((f) => f.event.assistantMessageEvent.delta).join("");
  const settledMs = Date.now() - t0;
  const lastCursor = events.at(-1).cursor;
  step("streamed reply", {
    ok: deltas.length > 0 && text.trim().length > 0,
    detail: `${deltas.length} text_delta frames, ${events.length} events, cursor 1..${lastCursor}, ${settledMs}ms to settled, text=${JSON.stringify(text.slice(0, 80))}`,
    textDeltaFrames: deltas.length,
    eventCount: events.length,
    settledMs,
    firstDeltaFramePosition: firstDeltaIndex,
  });
  if (deltas.length === 0) throw new Error("no text_delta received");

  // cursors must be strictly increasing with no gaps
  const cursors = events.map((f) => f.cursor);
  const monotonic = cursors.every((c, i) => i === 0 || c === cursors[i - 1] + 1);
  step("cursors strictly increasing without gaps", { ok: monotonic, detail: `${cursors[0]}..${cursors.at(-1)}` });
  if (!monotonic) throw new Error("cursor sequence broken");

  // ---- 3. disconnect (NOT a stop), reconnect with an older cursor ----
  a.socket.close();
  await new Promise((r) => setTimeout(r, 300));
  const after = Math.max(0, lastCursor - Math.min(5, lastCursor));
  const b = await connect();
  send(b.socket, { type: "open", sessionId, after });
  const reopened = await b.waitFor((f) => f.type === "opened", "reopened", 15_000);
  // replay arrives synchronously after `opened`; give the socket a moment to flush
  await new Promise((r) => setTimeout(r, 500));
  const replay = b.frames.filter((f) => f.type === "event");
  const replayCursors = replay.map((f) => f.cursor);
  const expected = cursors.filter((c) => c > after);
  const replayOk =
    reopened.sessionId === sessionId &&
    reopened.cursor === lastCursor &&
    JSON.stringify(replayCursors) === JSON.stringify(expected) &&
    !reopened.state.isStreaming;
  step("reconnect replays exactly cursor>after, session survived disconnect", {
    ok: replayOk,
    detail: `after=${after} replayed=[${replayCursors.join(",")}] expected=[${expected.join(",")}] hostCursor=${reopened.cursor} isStreaming=${reopened.state.isStreaming}`,
  });
  if (!replayOk) throw new Error("replay mismatch");
  b.socket.close();
  await new Promise((r) => setTimeout(r, 300));

  // ---- 4. reconnect fully caught up -> zero replay ----
  const c = await connect();
  send(c.socket, { type: "open", sessionId, after: lastCursor });
  await c.waitFor((f) => f.type === "opened", "reopened caught-up", 15_000);
  await new Promise((r) => setTimeout(r, 500));
  const none = c.frames.filter((f) => f.type === "event").length;
  step("caught-up reconnect replays nothing", { ok: none === 0, detail: `${none} events replayed` });
  if (none !== 0) throw new Error("unexpected replay when caught up");

  // ---- 5. a second turn on the SAME session proves it is still alive ----
  send(c.socket, { type: "prompt", requestId: "smoke-2", text: "Reply with exactly one word: again" });
  await c.waitFor((f) => f.type === "ack" && f.requestId === "smoke-2", "second ack", 15_000);
  const settled2 = await c.waitFor((f) => f.type === "event" && f.event?.type === "agent_settled", "second agent_settled");
  step("second turn on the same session after reconnects", { ok: settled2.cursor > lastCursor, detail: `cursor advanced ${lastCursor} -> ${settled2.cursor}` });
  send(c.socket, { type: "close" });
  c.socket.close();

  evidence.ok = true;
}

main()
  .catch((error) => {
    step("smoke aborted", { ok: false, detail: error.message });
    evidence.ok = false;
  })
  .finally(() => {
    evidence.finishedAt = new Date().toISOString();
    console.log("\n---- evidence (paste into the Gitea Issue; contains no secrets) ----");
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(evidence.ok ? 0 : 1);
  });
