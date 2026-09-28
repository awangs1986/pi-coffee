#!/usr/bin/env node

import {
  appendFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createServer } from "node:net";

if (process.env.PI_COFFEE_FAKE_LSP_STARTS)
  appendFileSync(process.env.PI_COFFEE_FAKE_LSP_STARTS, "start\n");

if (process.env.PI_COFFEE_FAKE_LSP_PID)
  writeFileSync(process.env.PI_COFFEE_FAKE_LSP_PID, String(process.pid));

let input = Buffer.alloc(0);
let opened = "";
let uri = "";
let version = 0;
let waitingHover;
let dependency = "";
let references = 0;
let pulls = 0;
let closedForBarrier = false;
const dependencyPath = process.env.PI_COFFEE_FAKE_LSP_DEPENDENCY_FILE ?? "lib.ts";
const readDependency = () =>
  existsSync(dependencyPath) ? readFileSync(dependencyPath, "utf8") : "missing";
const findings = () => [
  {
    range: range(1, 6),
    severity: 1,
    code: "fixture-error",
    message: "BAD is not assignable",
  },
];

// Documents opened in cascade mode: uri → text. A change to one document
// republishes every other open document, like tsserver or pyright do.
const documents = new Map();
const cascade = Boolean(process.env.PI_COFFEE_FAKE_LSP_CASCADE);

const onData = (chunk) => {
  input = Buffer.concat([input, chunk]);
  consume();
};
// PI_COFFEE_FAKE_LSP_TCP_PORT serves the same protocol over TCP, like Godot's
// editor language server, instead of stdio.
let output = process.stdout;
const tcpPort = Number(process.env.PI_COFFEE_FAKE_LSP_TCP_PORT);
if (tcpPort) {
  createServer((socket) => {
    output = socket;
    socket.on("data", onData);
    socket.on("error", () => {});
  }).listen(tcpPort, "127.0.0.1", () => {
    if (process.env.PI_COFFEE_FAKE_LSP_TCP_READY)
      writeFileSync(process.env.PI_COFFEE_FAKE_LSP_TCP_READY, "ready");
  });
} else process.stdin.on("data", onData);

function consume() {
  while (true) {
    const marker = input.indexOf("\r\n\r\n");
    if (marker < 0) return;
    const header = input.subarray(0, marker).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    const end = marker + 4 + length;
    if (input.length < end) return;
    const message = JSON.parse(
      input.subarray(marker + 4, end).toString("utf8"),
    );
    input = input.subarray(end);
    handle(message);
  }
}

function send(message) {
  const body = JSON.stringify(message);
  output.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function publish(forUri, text, forVersion) {
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: forUri,
      version: process.env.PI_COFFEE_FAKE_LSP_STALE
        ? forVersion - 1
        : process.env.PI_COFFEE_FAKE_LSP_VERSIONLESS
          ? undefined
          : forVersion,
      diagnostics: text.includes("BAD")
        ? [
            {
              range: {
                start: { line: 1, character: 6 },
                end: { line: 1, character: 9 },
              },
              severity: 1,
              code: "fixture-error",
              source: "fixture-lsp",
              message: "BAD is not assignable",
            },
          ]
        : [],
    },
  });
}

function reply(message, result) {
  send({ jsonrpc: "2.0", id: message.id, result });
}

function handle(message) {
  if (message.id === "fixture-settings" && !message.method) {
    reply(waitingHover, {
      contents: message.result?.[0]?.target ?? "missing-settings",
    });
    return;
  }
  if (message.id === "server-edit" && !message.method) {
    reply(waitingHover, {
      contents:
        message.result?.applied === false
          ? "server edit declined"
          : "server edit not declined",
    });
    return;
  }
  if (
    message.method === "$/cancelRequest" &&
    process.env.PI_COFFEE_FAKE_LSP_CANCEL
  ) {
    appendFileSync(process.env.PI_COFFEE_FAKE_LSP_CANCEL, "cancelled");
    return;
  }
  if (
    message.method === "initialized" &&
    process.env.PI_COFFEE_FAKE_LSP_PAUSE
  ) {
    process.stdin.pause();
    setInterval(() => {}, 1000);
    return;
  }
  if (
    message.method === "initialized" &&
    process.env.PI_COFFEE_FAKE_LSP_DYNAMIC
  ) {
    send({
      jsonrpc: "2.0",
      id: "register",
      method: "client/registerCapability",
      params: {
        registrations: [
          { id: "diagnostics", method: "textDocument/diagnostic" },
          { id: "hover", method: "textDocument/hover" },
        ],
      },
    });
    return;
  }
  if (message.method === "textDocument/diagnostic") {
    if (process.env.PI_COFFEE_FAKE_LSP_PULL_FAIL) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "pull failed" },
      });
      return;
    }
    reply(message, {
      kind: "full",
      items: process.env.PI_COFFEE_FAKE_LSP_PULL_SEQUENCE
        ? ++pulls === 1
          ? []
          : findings()
        : opened.includes("BAD")
          ? findings()
          : [],
    });
    return;
  }
  if (message.method === "workspace/didChangeWatchedFiles") {
    dependency = readDependency();
    return;
  }
  if (message.method === "initialize") {
    dependency = readDependency();
    if (process.env.PI_COFFEE_FAKE_LSP_INIT_FAIL) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "initialization failed" },
      });
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_INIT_HANG) {
      appendFileSync(
        process.env.PI_COFFEE_FAKE_LSP_INIT_HANG,
        String(process.pid),
      );
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_NOISE)
      process.stdout.write("server starting\r\n\r\n");
    const initialized = {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: 2,
        documentSymbolProvider: !process.env.PI_COFFEE_FAKE_LSP_NO_SYMBOLS,
        definitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        hoverProvider: !process.env.PI_COFFEE_FAKE_LSP_DYNAMIC,
      },
    };
    if (process.env.PI_COFFEE_FAKE_LSP_INIT_DELAY)
      setTimeout(
        () => reply(message, initialized),
        Number(process.env.PI_COFFEE_FAKE_LSP_INIT_DELAY),
      );
    else reply(message, initialized);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
  if (message.method === "shutdown") {
    reply(message, null);
    return;
  }
  if (
    message.method === "textDocument/didClose" &&
    process.env.PI_COFFEE_FAKE_LSP_BARRIER_HANG
  ) {
    opened = "";
    closedForBarrier = true;
    return;
  }
  if (message.method === "textDocument/didClose")
    documents.delete(message.params.textDocument.uri);
  if (
    message.method === "textDocument/didOpen" ||
    message.method === "textDocument/didChange"
  ) {
    const previousWasClean = !opened.includes("BAD");
    if (
      process.env.PI_COFFEE_FAKE_LSP_SAME_TEXT &&
      opened &&
      opened ===
        (message.params.textDocument.text ??
          message.params.contentChanges?.at(-1)?.text)
    )
      return;
    uri = process.env.PI_COFFEE_FAKE_LSP_RAW_URI
      ? decodeURIComponent(message.params.textDocument.uri)
      : message.params.textDocument.uri;
    if (
      process.env.PI_COFFEE_FAKE_LSP_LANGUAGE_ID &&
      message.method === "textDocument/didOpen"
    )
      appendFileSync(
        process.env.PI_COFFEE_FAKE_LSP_LANGUAGE_ID,
        `${message.params.textDocument.languageId}\n`,
      );
    version = message.params.textDocument.version;
    opened =
      message.params.textDocument.text ??
      message.params.contentChanges?.at(-1)?.text ??
      opened;
    if (cascade) {
      documents.set(uri, { text: opened, version });
      // Every open document depends on every other one in this fixture: BAD
      // anywhere in the open set is an error in each open document, and every
      // change republishes the whole set, like tsserver or pyright do.
      setTimeout(() => {
        const anyBad = [...documents.values()].some((document) =>
          document.text.includes("BAD"),
        );
        for (const [documentUri, document] of documents)
          publish(documentUri, anyBad ? "BAD" : "", document.version);
      }, 10);
      return;
    }
    if (
      process.env.PI_COFFEE_FAKE_LSP_SUPPRESS_CLEAN &&
      message.method === "textDocument/didChange" &&
      previousWasClean &&
      !opened.includes("BAD")
    )
      return;
    if (
      (process.env.PI_COFFEE_FAKE_LSP_SILENT_FILE &&
        uri.endsWith("silent.ts")) ||
      process.env.PI_COFFEE_FAKE_LSP_DYNAMIC ||
      process.env.PI_COFFEE_FAKE_LSP_SILENT
    )
      return;
    setTimeout(
      () =>
        send({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri,
            version: process.env.PI_COFFEE_FAKE_LSP_STALE
              ? version - 1
              : process.env.PI_COFFEE_FAKE_LSP_VERSIONLESS
                ? undefined
                : version,
            diagnostics: opened.includes("BAD")
              ? [
                  {
                    range: {
                      start: { line: 1, character: 6 },
                      end: { line: 1, character: 9 },
                    },
                    severity: 1,
                    code: "fixture-error",
                    source: "fixture-lsp",
                    message: "BAD is not assignable",
                  },
                ]
              : [],
          },
        }),
      10,
    );
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    if (closedForBarrier && process.env.PI_COFFEE_FAKE_LSP_BARRIER_HANG) {
      if (process.env.PI_COFFEE_FAKE_LSP_BARRIER_STARTED)
        writeFileSync(process.env.PI_COFFEE_FAKE_LSP_BARRIER_STARTED, "ready");
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_UNREGISTER)
      send({
        jsonrpc: "2.0",
        id: "unregister",
        method: "client/unregisterCapability",
        params: {
          unregisterations: [
            { id: "diagnostics", method: "textDocument/diagnostic" },
            { id: "hover", method: "textDocument/hover" },
          ],
        },
      });
    reply(message, [
      {
        name: "target",
        kind: 12,
        range: range(0, 16),
        selectionRange: range(0, 16),
      },
    ]);
    return;
  }
  if (
    ["textDocument/definition", "textDocument/implementation"].includes(
      message.method,
    )
  ) {
    reply(message, [{ uri, range: range(0, 16) }]);
    return;
  }
  if (message.method === "textDocument/references") {
    if (process.env.PI_COFFEE_FAKE_LSP_REFERENCES && references++ < 2) {
      reply(message, []);
      return;
    }
    reply(message, [{ uri, range: range(1, 6) }]);
    return;
  }
  if (message.method === "textDocument/hover") {
    if (process.env.PI_COFFEE_FAKE_LSP_BARRIER_HANG && !opened) {
      reply(message, null);
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_HOVER_STARTED)
      writeFileSync(process.env.PI_COFFEE_FAKE_LSP_HOVER_STARTED, "ready");
    if (process.env.PI_COFFEE_FAKE_LSP_DEPENDENCY) {
      reply(message, { contents: dependency });
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_SETTINGS) {
      waitingHover = message;
      send({
        jsonrpc: "2.0",
        id: "fixture-settings",
        method: "workspace/configuration",
        params: { items: [{ section: "fixture" }] },
      });
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_CANCEL) return;
    if (process.env.PI_COFFEE_FAKE_LSP_APPLY) {
      waitingHover = message;
      send({
        jsonrpc: "2.0",
        id: "server-edit",
        method: "workspace/applyEdit",
        params: {
          edit: {
            changes: { [uri]: [{ range: range(0, 0), newText: "MUTATED" }] },
          },
        },
      });
      return;
    }
    if (process.env.PI_COFFEE_FAKE_LSP_DELAY) {
      setTimeout(
        () => reply(message, { contents: "const target: number" }),
        Number(process.env.PI_COFFEE_FAKE_LSP_DELAY),
      );
      return;
    }
    reply(message, {
      contents: { kind: "plaintext", value: "const target: number" },
      range: range(0, 16),
    });
    return;
  }
  if (message.id !== undefined) reply(message, null);
}

function range(line, character) {
  return {
    start: { line, character },
    end: { line, character: character + 6 },
  };
}
