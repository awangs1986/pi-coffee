import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { RelayServer, type RelayRecord } from "../src/relay/server.js";

/**
 * A stand-in for the CPA upstream. Each test installs its own handler so the
 * failure mode under test (error status, broken stream, hang, slow reader) is
 * explicit in the test body.
 */
class StubUpstream {
  readonly server: Server;
  readonly seen: Array<{ method: string; url: string; headers: IncomingMessage["headers"]; body: string; aborted: boolean }> = [];
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };

  constructor() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: "", aborted: false };
      this.seen.push(entry);
      req.on("close", () => {
        if (!res.writableFinished) entry.aborted = true;
      });
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        entry.body = Buffer.concat(chunks).toString("utf8");
        this.handler(req, res, entry.body);
      });
    });
  }

  async start(): Promise<string> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    return `http://127.0.0.1:${address.port}/v1`;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

interface ClientResponse {
  status: number;
  headers: IncomingMessage["headers"];
  body: string;
}

function relayUrl(relay: RelayServer, path: string): string {
  const { host, port } = relay.address();
  return `http://${host}:${port}${path}`;
}

async function call(
  relay: RelayServer,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ClientResponse> {
  const response = await fetch(relayUrl(relay, path), {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
  return { status: response.status, headers: Object.fromEntries(response.headers) as IncomingMessage["headers"], body: await response.text() };
}

const UPSTREAM_KEY = "upstream-secret-key";
const CLIENT_TOKEN = "host-relay-token";

let upstream: StubUpstream | undefined;
let relay: RelayServer | undefined;
let records: RelayRecord[] = [];

async function startRelay(overrides: Partial<ConstructorParameters<typeof RelayServer>[0]> = {}): Promise<RelayServer> {
  upstream = upstream ?? new StubUpstream();
  const upstreamBaseUrl = await upstream.start();
  records = [];
  relay = new RelayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl,
    upstreamKey: UPSTREAM_KEY,
    clientTokens: [CLIENT_TOKEN],
    onRecord: (record) => records.push(record),
    ...overrides,
  });
  await relay.start();
  return relay;
}

afterEach(async () => {
  await relay?.close();
  relay = undefined;
  await upstream?.close();
  upstream = undefined;
});

const auth = { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" };

describe("RelayServer", () => {
  it("swaps the client token for the sole upstream key and passes JSON through untouched", async () => {
    const r = await startRelay();
    upstream!.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "x-request-id": "up-123" });
      res.end(JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { content: "coffee ready" } }] }));
    };
    const body = JSON.stringify({ model: "gpt-5.4-mini", messages: [{ role: "user", content: "SECRET PROMPT TEXT" }] });

    const response = await call(r, "/v1/chat/completions", { method: "POST", headers: { ...auth, "x-api-key": "leak-me" }, body });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).choices[0].message.content).toBe("coffee ready");
    expect(response.headers["x-request-id"]).toBe("up-123");

    const seen = upstream!.seen[0];
    expect(seen.url).toBe("/v1/chat/completions");
    expect(seen.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(seen.headers["x-api-key"]).toBeUndefined();
    expect(seen.body).toBe(body);

    // Metadata is bounded and content-free: model/route/timing, never the prompt.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ route: "/v1/chat/completions", method: "POST", model: "gpt-5.4-mini", stream: false, status: 200, outcome: "completed" });
    expect(JSON.stringify(records[0])).not.toContain("SECRET PROMPT TEXT");
    expect(JSON.stringify(records[0])).not.toContain("coffee ready");
    expect(JSON.stringify(records[0])).not.toContain(UPSTREAM_KEY);
  });

  it("relays /v1/models and /v1/responses/compact and rejects everything else", async () => {
    const r = await startRelay();
    upstream!.handler = (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    };

    const models = await call(r, "/v1/models", { headers: { authorization: `Bearer ${CLIENT_TOKEN}` } });
    expect(models.status).toBe(200);
    expect(JSON.parse(models.body).path).toBe("/v1/models");

    const compact = await call(r, "/v1/responses/compact", { method: "POST", headers: auth, body: "{}" });
    expect(compact.status).toBe(200);
    expect(JSON.parse(compact.body).path).toBe("/v1/responses/compact");

    const responses = await call(r, "/v1/responses", { method: "POST", headers: auth, body: JSON.stringify({ model: "gpt-5.5", input: "hi", stream: false }) });
    expect(responses.status).toBe(200);

    const unknown = await call(r, "/v1/files", { method: "POST", headers: auth, body: "{}" });
    expect(unknown.status).toBe(404);
    const wrongMethod = await call(r, "/v1/chat/completions", { headers: { authorization: `Bearer ${CLIENT_TOKEN}` } });
    expect(wrongMethod.status).toBe(405);
    expect(upstream!.seen).toHaveLength(3);
  });

  it("keeps the Serper credential on the Control Plane and returns bounded search results", async () => {
    upstream = new StubUpstream();
    const base = await upstream.start();
    records = [];
    relay = new RelayServer({
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: base,
      upstreamKey: UPSTREAM_KEY,
      serperApiKey: "serper-secret",
      serperEndpoint: `${base.replace(/\/v1$/, "")}/serper`,
      clientTokens: [CLIENT_TOKEN],
      onRecord: (record) => records.push(record),
    });
    await relay.start();
    const r = relay;
    upstream!.handler = (req, res, body) => {
      expect(req.url).toBe("/serper");
      expect(req.headers["x-api-key"]).toBe("serper-secret");
      expect(body).toContain("site:example.com");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ organic: [
        { title: "A", link: "https://example.com/a", snippet: "one" },
        { title: "private", link: "http://127.0.0.1/no", snippet: "drop" },
      ] }));
    };
    const response = await call(r, "/v1/search/serper", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ queries: ["pi coffee"], numResults: 5, domainFilter: ["example.com"] }),
    });
    expect(response.status).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.provider).toBe("serper");
    expect(payload.results).toEqual([{ title: "A", url: "https://example.com/a", snippet: "one" }]);
    expect(JSON.stringify(records)).not.toContain("serper-secret");
    expect(JSON.stringify(records)).not.toContain("pi coffee");
  });

  it("reports a bounded error when Serper is not configured", async () => {
    const r = await startRelay();
    const response = await call(r, "/v1/search/serper", { method: "POST", headers: auth, body: JSON.stringify({ query: "x" }) });
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).error.type).toBe("relay_search_unconfigured");
  });

  it("rejects missing or wrong client tokens before touching the upstream", async () => {
    const r = await startRelay();
    const missing = await call(r, "/v1/models");
    expect(missing.status).toBe(401);
    const wrong = await call(r, "/v1/models", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    expect(upstream!.seen).toHaveLength(0);
    expect(records.map((x) => x.outcome)).toEqual(["rejected", "rejected"]);
  });

  it("refuses to bind to a non-loopback address without client tokens", async () => {
    upstream = new StubUpstream();
    const upstreamBaseUrl = await upstream.start();
    relay = new RelayServer({ host: "0.0.0.0", port: 0, upstreamBaseUrl, upstreamKey: UPSTREAM_KEY, clientTokens: [] });
    await expect(relay.start()).rejects.toThrow(/PI_COFFEE_RELAY_TOKENS/);
    expect(() => relay?.address()).toThrow(/not listening/);
    relay = undefined;
  });

  it("refuses to start without an upstream key", () => {
    expect(() => new RelayServer({ upstreamBaseUrl: "http://127.0.0.1:1/v1", upstreamKey: "", clientTokens: [CLIENT_TOKEN] })).toThrow(/PI_COFFEE_UPSTREAM_KEY/);
  });

  it("streams SSE chunk by chunk without buffering the whole response", async () => {
    const r = await startRelay();
    let releaseSecond!: () => void;
    const secondReleased = new Promise<void>((resolve) => (releaseSecond = resolve));
    upstream!.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write("data: {\"choices\":[{\"delta\":{\"content\":\"coffee\"}}]}\n\n");
      void secondReleased.then(() => {
        res.write("data: {\"choices\":[{\"delta\":{\"content\":\" ready\"}}]}\n\n");
        res.end("data: [DONE]\n\n");
      });
    };

    const response = await fetch(relayUrl(r, "/v1/chat/completions"), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "gpt-5.4-mini", stream: true, messages: [] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    // The first chunk must arrive while the upstream is still holding the
    // second one back. A buffering relay would hang here.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("coffee");

    releaseSecond();
    let rest = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += decoder.decode(next.value, { stream: true });
    }
    expect(rest).toContain(" ready");
    expect(rest).toContain("[DONE]");

    await waitFor(() => records.length === 1);
    expect(records[0]).toMatchObject({ stream: true, status: 200, outcome: "completed" });
    expect(records[0].firstByteMs).toBeTypeOf("number");
  });

  it("passes upstream error statuses and bodies through", async () => {
    const r = await startRelay();
    upstream!.handler = (_req, res) => {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
      res.end(JSON.stringify({ error: { message: "rate limited", type: "rate_limit" } }));
    };
    const response = await call(r, "/v1/chat/completions", { method: "POST", headers: auth, body: "{\"model\":\"m\"}" });
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("7");
    expect(JSON.parse(response.body).error.type).toBe("rate_limit");
    expect(records[0]).toMatchObject({ status: 429, outcome: "upstream_error" });
  });

  it("answers 502 when the upstream is unreachable", async () => {
    upstream = new StubUpstream();
    const base = await upstream.start();
    await upstream.close();
    upstream = undefined;
    relay = new RelayServer({ host: "127.0.0.1", port: 0, upstreamBaseUrl: base, upstreamKey: UPSTREAM_KEY, clientTokens: [CLIENT_TOKEN], onRecord: (x) => records.push(x) });
    records = [];
    await relay.start();

    const response = await call(relay, "/v1/chat/completions", { method: "POST", headers: auth, body: "{\"model\":\"m\"}" });
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body).error.type).toBe("relay_upstream_unreachable");
    expect(records[0].outcome).toBe("upstream_unreachable");
  });

  it("answers 504 when the upstream never sends headers", async () => {
    const r = await startRelay({ upstreamHeadersTimeoutMs: 150 });
    upstream!.handler = () => {
      /* hang: never respond */
    };
    const started = Date.now();
    const response = await call(r, "/v1/chat/completions", { method: "POST", headers: auth, body: "{\"model\":\"m\"}" });
    expect(response.status).toBe(504);
    expect(JSON.parse(response.body).error.type).toBe("relay_upstream_timeout");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(records[0].outcome).toBe("upstream_timeout");
    await waitFor(() => upstream!.seen[0]?.aborted === true);
  });

  it("terminates the client stream when the upstream breaks mid-stream instead of ending it cleanly", async () => {
    const r = await startRelay();
    upstream!.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: partial\n\n");
      setTimeout(() => res.destroy(), 50);
    };
    const response = await fetch(relayUrl(r, "/v1/responses"), { method: "POST", headers: auth, body: "{\"model\":\"m\",\"stream\":true}" });
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
    await waitFor(() => records.length === 1);
    expect(records[0].outcome).toBe("upstream_stream_broken");
  });

  it("aborts the upstream request when the client disconnects", async () => {
    const r = await startRelay();
    let upstreamRes: ServerResponse | undefined;
    upstream!.handler = (_req, res) => {
      upstreamRes = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      // Keep the stream open; the client will go away.
    };
    const { host, port } = r.address();
    const req = httpRequest({ host, port, method: "POST", path: "/v1/chat/completions", headers: auth });
    req.end("{\"model\":\"m\",\"stream\":true}");
    const [res] = (await once(req, "response")) as [IncomingMessage];
    await once(res, "data");
    req.destroy();

    await waitFor(() => upstream!.seen[0]?.aborted === true);
    await waitFor(() => records.length === 1);
    expect(records[0].outcome).toBe("client_aborted");
    upstreamRes?.destroy();
  });

  it("rejects oversized request bodies with 413 without contacting the upstream", async () => {
    const r = await startRelay({ maxRequestBytes: 1024 });
    const response = await call(r, "/v1/chat/completions", { method: "POST", headers: auth, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(4096) }] }) });
    expect(response.status).toBe(413);
    expect(upstream!.seen).toHaveLength(0);
    expect(records[0].outcome).toBe("rejected");
  });

  it("propagates backpressure from a slow client to the upstream instead of buffering", async () => {
    const r = await startRelay();
    let sawBackpressure = false;
    const chunk = Buffer.alloc(64 * 1024, "a");
    upstream!.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let written = 0;
      const pump = () => {
        while (written < 64 * 1024 * 1024) {
          written += chunk.length;
          if (!res.write(chunk)) {
            sawBackpressure = true;
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
    };

    const { host, port } = r.address();
    const req = httpRequest({ host, port, method: "POST", path: "/v1/chat/completions", headers: auth });
    req.end("{\"model\":\"m\",\"stream\":true}");
    const [res] = (await once(req, "response")) as [IncomingMessage];
    // Read one chunk, then stop reading for a while: the relay must stop
    // pulling from the upstream rather than absorb 64 MiB into memory.
    await once(res, "data");
    res.pause();
    await waitFor(() => sawBackpressure, 5000);
    expect(sawBackpressure).toBe(true);
    req.destroy();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
