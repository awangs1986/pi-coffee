import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sanitizeFileName, TransferServer } from "../src/host/transfer.js";
import type { JsonValue } from "../src/shared/protocol.js";

let server: TransferServer | undefined;
let workdir: string;
let events: Array<{ scope: string; event: JsonValue }> = [];

async function start(overrides: Partial<ConstructorParameters<typeof TransferServer>[0]> = {}): Promise<{ base: string; token: string }> {
  workdir = mkdtempSync(join(tmpdir(), "pi-coffee-transfer-"));
  events = [];
  server = new TransferServer({ allowUnscoped: true, host: "127.0.0.1", port: 0, workdir, advertiseHost: "127.0.0.1", onEvent: (scope, event) => events.push({ scope, event }), ...overrides });
  await server.start();
  return { base: `http://127.0.0.1:${server.address().port}/api/localsend/v2`, token: server.issueToken("sess-1") };
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function prepare(base: string, token: string, files: Record<string, unknown>, scope = "sess-1") {
  const response = await fetch(`${base}/prepare-upload?scope=${scope}&token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ info: { alias: "browser", version: "2.0", deviceType: "web", fingerprint: "x", port: 0, protocol: "http" }, files }),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() as { sessionId: string; files: Record<string, string> } : await response.json() };
}

describe("TransferServer (LocalSend v2)", () => {
  it("answers info/register with a LocalSend device description and CORS headers", async () => {
    const { base } = await start();
    const info = await fetch(`${base}/info`);
    expect(info.headers.get("access-control-allow-origin")).toBe("*");
    expect(await info.json()).toMatchObject({ version: "2.0", deviceType: "server", protocol: "http", download: true });
    const preflight = await fetch(`${base}/upload`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(server!.publicUrl()).toBe(`http://127.0.0.1:${server!.address().port}`);
  });

  it("runs the two-step upload into the scoped inbox, verifies sha256 and reports progress/completion", async () => {
    const { base, token } = await start();
    const content = Buffer.from("hello inbox\n".repeat(1000));
    const prepared = await prepare(base, token, {
      f1: { id: "f1", fileName: "notes.txt", size: content.length, fileType: "text/plain", sha256: sha(content) },
      f2: { id: "f2", fileName: "../../evil.sh", size: 3, fileType: "text/x-sh" },
    });
    expect(prepared.status).toBe(200);
    const { sessionId, files } = prepared.body as { sessionId: string; files: Record<string, string> };
    expect(Object.keys(files)).toEqual(["f1", "f2"]);

    const up1 = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f1&token=${files.f1}`, { method: "POST", body: content });
    expect(up1.status).toBe(200);
    const up2 = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f2&token=${files.f2}`, { method: "POST", body: "abc" });
    expect(up2.status).toBe(200);

    const inbox = join(workdir, ".pi-coffee", "inbox", "sess-1");
    expect(readFileSync(join(inbox, "notes.txt"))).toEqual(content);
    // Path traversal in the name is neutralised; the file stays inside the inbox.
    expect(readdirSync(inbox).sort()).toEqual(["evil.sh", "notes.txt"]);
    expect(existsSync(join(workdir, "evil.sh"))).toBe(false);

    const complete = events.filter((e) => (e.event as { type: string }).type === "transfer_complete");
    expect(complete.map((e) => e.scope)).toEqual(["sess-1", "sess-1"]);
    expect(complete[0].event).toMatchObject({ fileId: "f1", fileName: "notes.txt", path: ".pi-coffee/inbox/sess-1/notes.txt", size: content.length, sha256: sha(content) });
    // No .part leftovers.
    expect(readdirSync(inbox).some((n) => n.endsWith(".part"))).toBe(false);
  });

  it("rejects wrong tokens, oversized declarations, checksum mismatches and byte overruns", async () => {
    const { base, token } = await start({ maxFileBytes: 1024, maxBatchBytes: 1500 });
    expect((await prepare(base, "wrong", { f: { id: "f", fileName: "a", size: 1 } })).status).toBe(401);
    expect((await prepare(base, token, { f: { id: "f", fileName: "a", size: 2048 } })).status).toBe(403);
    expect((await prepare(base, token, { a: { id: "a", fileName: "a", size: 1000 }, b: { id: "b", fileName: "b", size: 1000 } })).status).toBe(403);
    expect((await prepare(base, token, {})).status).toBe(400);

    const prepared = await prepare(base, token, { f: { id: "f", fileName: "x.bin", size: 4, sha256: sha("abcd") } });
    const { sessionId, files } = prepared.body as { sessionId: string; files: Record<string, string> };
    expect((await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f&token=nope`, { method: "POST", body: "abcd" })).status).toBe(403);
    const mismatch = await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f&token=${files.f}`, { method: "POST", body: "abce" });
    expect(mismatch.status).toBe(422);
    expect(existsSync(join(workdir, ".pi-coffee", "inbox", "sess-1", "x.bin"))).toBe(false);
    expect(events.some((e) => (e.event as { type: string }).type === "transfer_failed")).toBe(true);

    const again = await prepare(base, token, { g: { id: "g", fileName: "y.bin", size: 2 } });
    const s2 = again.body as { sessionId: string; files: Record<string, string> };
    const overrun = await fetch(`${base}/upload?sessionId=${s2.sessionId}&fileId=g&token=${s2.files.g}`, { method: "POST", body: "toolong" }).catch(() => ({ status: 413 }));
    expect([400, 413]).toContain(overrun.status);
  });

  it("preserves both files when overlapping upload batches use the same name", async () => {
    const { base, token } = await start();
    const batches = await Promise.all(["one", "two"].map(() =>
      prepare(base, token, { f: { fileName: "notes.txt", size: 3 } })));
    for (const [index, batch] of batches.entries()) {
      const { sessionId, files } = batch.body;
      expect((await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f&token=${files.f}`, {
        method: "POST", body: ["one", "two"][index],
      })).status).toBe(200);
    }
    const inbox = join(workdir, server!.inboxFor("sess-1"));
    expect(readdirSync(inbox).map(name => readFileSync(join(inbox, name), "utf8")).sort()).toEqual(["one", "two"]);
  });

  it("rejects reusing a completed file grant while another file in the batch is pending", async () => {
    const { base, token } = await start();
    const { body: { sessionId, files } } = await prepare(base, token, {
      f: { fileName: "notes.txt", size: 3 },
      pending: { fileName: "later.txt", size: 3 },
    });
    const url = `${base}/upload?sessionId=${sessionId}&fileId=f&token=${files.f}`;
    expect((await fetch(url, { method: "POST", body: "one" })).status).toBe(200);
    expect((await fetch(url, { method: "POST", body: "two" })).status).toBe(409);
    expect(readFileSync(join(workdir, server!.inboxFor("sess-1"), "notes.txt"), "utf8")).toBe("one");
  });

  it("does not overwrite a file created after upload preparation", async () => {
    const { base, token } = await start();
    const { body: { sessionId, files } } = await prepare(base, token, { f: { fileName: "notes.txt", size: 3 } });
    const inbox = join(workdir, server!.inboxFor("sess-1"));
    writeFileSync(join(inbox, "notes.txt"), "user work");
    expect((await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f&token=${files.f}`, {
      method: "POST", body: "one",
    })).status).toBe(200);
    expect(readFileSync(join(inbox, "notes.txt"), "utf8")).toBe("user work");
    expect(readdirSync(inbox).map(name => readFileSync(join(inbox, name), "utf8")).sort()).toEqual(["one", "user work"]);
  });

  it("cancel removes partial state, and plain LocalSend clients land in the shared inbox", async () => {
    const { base, token } = await start();
    const prepared = await prepare(base, token, { f: { id: "f", fileName: "later.txt", size: 5 } });
    const { sessionId, files } = prepared.body as { sessionId: string; files: Record<string, string> };
    expect((await fetch(`${base}/cancel?sessionId=${sessionId}`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${base}/upload?sessionId=${sessionId}&fileId=f&token=${files.f}`, { method: "POST", body: "hello" })).status).toBe(403);

    // A LocalSend app knows nothing about scopes/tokens: it gets the shared inbox.
    const plain = await fetch(`${base}/prepare-upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: { p: { id: "p", fileName: "phone.jpg", size: 2 } } }) });
    expect(plain.status).toBe(200);
    const body = await plain.json() as { sessionId: string; files: Record<string, string> };
    expect((await fetch(`${base}/upload?sessionId=${body.sessionId}&fileId=p&token=${body.files.p}`, { method: "POST", body: "hi" })).status).toBe(200);
    expect(existsSync(join(workdir, ".pi-coffee", "inbox", "shared", "phone.jpg"))).toBe(true);
    expect(events.at(-1)?.scope).toBe("shared");
  });

  it("lists the inbox and downloads files under the working directory only", async () => {
    const { base, token } = await start();
    const inbox = join(workdir, ".pi-coffee", "inbox", "sess-1");
    const outDir = join(workdir, "out");
    for (const dir of [inbox, outDir]) rmSync(dir, { recursive: true, force: true });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(inbox, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(inbox, "report.md"), "# report");
    writeFileSync(join(outDir, "result.csv"), "a,b\n1,2\n");
    writeFileSync(join(tmpdir(), "pi-coffee-outside.txt"), "secret");

    const listed = await fetch(`${base}/prepare-download?scope=sess-1&token=${token}`, { method: "POST" });
    expect(listed.status).toBe(200);
    const body = await listed.json() as { sessionId: string; files: Record<string, { fileName: string; size: number }> };
    expect(body.files[".pi-coffee/inbox/sess-1/report.md"]).toMatchObject({ fileName: "report.md", size: 8 });

    const dl = await fetch(`${base}/download?scope=sess-1&token=${token}&fileId=${encodeURIComponent("out/result.csv")}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("result.csv");
    expect(await dl.text()).toBe("a,b\n1,2\n");
    expect((await fetch(`${base}/download?scope=sess-1&token=${token}&fileId=${encodeURIComponent("../pi-coffee-outside.txt")}`)).status).toBe(403);
    expect((await fetch(`${base}/download?scope=sess-1&token=bad&fileId=out/result.csv`)).status).toBe(401);
    expect((await fetch(`${base}/download?scope=sess-1&token=${token}&fileId=missing.txt`)).status).toBe(404);
  });

  it("speaks HTTPS with a certificate fingerprint when given TLS material (the optional secure route)", async () => {
    const cert = readFileSync(join(process.cwd(), "test/fixtures/tls/test-cert.pem"));
    const key = readFileSync(join(process.cwd(), "test/fixtures/tls/test-key.pem"));
    const { base, token } = await start({ tls: { cert, key } });
    expect(server!.publicUrl()).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    const httpsBase = base.replace("http://", "https://");
    const info = await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      httpsRequest({ host: "127.0.0.1", port: server!.address().port, path: "/api/localsend/v2/info", ca: cert }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolvePromise(JSON.parse(body)));
      }).on("error", reject).end();
    });
    expect(info.protocol).toBe("https");
    // LocalSend: over HTTPS the fingerprint is the certificate's SHA-256.
    expect(info.fingerprint).toBe(new X509Certificate(cert).fingerprint256.replace(/:/g, "").toLowerCase());
    // A plain-HTTP client is refused by TLS, which is the point.
    await expect(fetch(`${base}/info`)).rejects.toThrow();
    void httpsBase;
    void token;
  });

  it("sanitizes file names without losing the extension", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\report:final?.pdf")).toBe("report_final_.pdf");
    expect(sanitizeFileName(".hidden")).toBe("hidden");
    expect(sanitizeFileName("   ")).toBe("file");
  });
});
