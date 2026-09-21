#!/usr/bin/env node

import { appendFileSync } from "node:fs";

if (process.env.PI_COFFEE_FAKE_LSP_STARTS) appendFileSync(process.env.PI_COFFEE_FAKE_LSP_STARTS, "start\n");

let input = Buffer.alloc(0);
let opened = "";
let uri = "";
let version = 0;

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  consume();
});

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
    const message = JSON.parse(input.subarray(marker + 4, end).toString("utf8"));
    input = input.subarray(end);
    handle(message);
  }
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function reply(message, result) {
  send({ jsonrpc: "2.0", id: message.id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    reply(message, { capabilities: {
      positionEncoding: "utf-16",
      textDocumentSync: 2,
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
    } });
    return;
  }
  if (message.method === "shutdown") { reply(message, null); return; }
  if (message.method === "textDocument/didOpen" || message.method === "textDocument/didChange") {
    uri = message.params.textDocument.uri;
    version = message.params.textDocument.version;
    opened = message.params.textDocument.text ?? message.params.contentChanges?.at(-1)?.text ?? opened;
    setTimeout(() => send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
      uri, version,
      diagnostics: opened.includes("BAD") ? [{
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 9 } },
        severity: 1,
        code: "fixture-error",
        source: "fixture-lsp",
        message: "BAD is not assignable",
      }] : [],
    } }), 10);
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    reply(message, [{ name: "target", kind: 12, range: range(0, 16), selectionRange: range(0, 16) }]);
    return;
  }
  if (message.method === "textDocument/definition") {
    reply(message, [{ uri, range: range(0, 16) }]);
    return;
  }
  if (message.method === "textDocument/references") {
    reply(message, [{ uri, range: range(1, 6) }]);
    return;
  }
  if (message.method === "textDocument/hover") {
    reply(message, { contents: { kind: "plaintext", value: "const target: number" }, range: range(0, 16) });
    return;
  }
  if (message.id !== undefined) reply(message, null);
}

function range(line, character) {
  return { start: { line, character }, end: { line, character: character + 6 } };
}
