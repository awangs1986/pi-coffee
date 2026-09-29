// Adapted from OMP b1a8b875; see third_party/oh-my-pi/LICENSE and README.md.
import { setTimeout as sleep } from "node:timers/promises";
import { EquivalentUriMap } from "./uri.js";
type Diagnostic = any;
export interface PublishedDiagnostics {
  diagnostics: Diagnostic[];
  version: number | null;
}
export interface DiagnosticResult {
  confirmed: boolean;
  items: Diagnostic[];
}
export interface DiagnosticSource {
  diagnostics: EquivalentUriMap<PublishedDiagnostics>;
  diagnosticsVersion: number;
  startedAt: number;
  openFiles: EquivalentUriMap<{ version: number }>;
  supportsDiagnosticPull(): boolean;
  pullDiagnostics(
    uri: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<any>;
}
type LspClient = DiagnosticSource;
const DIAGNOSTICS_POLL_MS = 25;
const DIAGNOSTICS_SETTLE_MS = 250;
const DEFERRED_DIAGNOSTICS_WAIT_TIMEOUT_MS = 12_000;
function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
interface WaitForDiagnosticsOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  minVersion?: number;
  expectedDocumentVersion?: number;
  /**
   * Quiescence window (ms). typescript-language-server never echoes the document
   * version (issue #983) and emits diagnostics from several sources at different
   * times, so there is no single "complete, version-matched" publish to gate on.
   * When the server does not exact-version-match, accept the latest publish only
   * after no newer one has arrived for this long, letting an in-flight pre-edit
   * publish be superseded by the fresh one.
   */
  settleMs?: number;
}

/**
 * Outcome of one document pull-diagnostic request.
 *
 * Distinguishes a usable report from a failed request so a timeout or RPC error
 * is never mistaken for a clean file. `diagnostics` holds the report's items (an
 * empty array means the server reported the file clean); `failed` carries the
 * error when the pull could not complete.
 */
interface PullDiagnosticsOutcome {
  diagnostics?: Diagnostic[];
  failed?: unknown;
}

function requestDocumentDiagnostics(
  client: LspClient,
  uri: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<PullDiagnosticsOutcome> {
  return client
    .pullDiagnostics(uri, signal, timeoutMs)
    .then((report) => {
      if (
        !report ||
        typeof report !== "object" ||
        !("kind" in report) ||
        report.kind !== "full"
      ) {
        return {};
      }
      if (!("items" in report) || !Array.isArray(report.items)) return {};
      return { diagnostics: report.items };
    })
    .catch((err) => {
      // Keep the failure separate from an empty successful report.
      return { failed: err };
    });
}

function isProvisionalColdPublish(
  client: LspClient,
  published: PublishedDiagnostics,
  expectedDocumentVersion: number | undefined,
  now: number,
): boolean {
  return (
    expectedDocumentVersion !== undefined &&
    published.version === null &&
    published.diagnostics.length === 0 &&
    client.startedAt !== undefined &&
    now - client.startedAt < DEFERRED_DIAGNOSTICS_WAIT_TIMEOUT_MS
  );
}

export async function waitForDiagnostics(
  client: LspClient,
  uri: string,
  options: WaitForDiagnosticsOptions = {},
): Promise<DiagnosticResult> {
  const {
    timeoutMs = 3000,
    signal,
    minVersion,
    expectedDocumentVersion,
    settleMs = DIAGNOSTICS_SETTLE_MS,
  } = options;
  const deadline = Date.now() + timeoutMs;
  const initialPublished = client.diagnostics.get(uri);
  let pullAttempted = false;
  let pullResultPromise: Promise<PullDiagnosticsOutcome> | undefined;
  let pulled: Diagnostic[] | undefined;
  let pullFailure: unknown;
  let settledRef: PublishedDiagnostics | undefined;
  let settledAt = 0;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (!pullAttempted && client.supportsDiagnosticPull()) {
      pullAttempted = true;
      pullResultPromise = requestDocumentDiagnostics(
        client,
        uri,
        signal,
        Math.max(1, deadline - Date.now()),
      );
    }

    const versionOk =
      minVersion === undefined || client.diagnosticsVersion > minVersion;
    const published = client.diagnostics.get(uri);
    if (
      published &&
      versionOk &&
      !pullResultPromise &&
      pulled === undefined &&
      (!pullAttempted || published !== initialPublished)
    ) {
      // Server honored our exact document version → authoritative, accept now.
      if (
        expectedDocumentVersion !== undefined &&
        published.version === expectedDocumentVersion
      ) {
        return { confirmed: true, items: published.diagnostics };
      }
      // An empty unversioned publish from a newly started server is often its
      // pre-analysis placeholder. Wait within the caller's budget; expiration
      // without an authoritative report remains inconclusive.
      const now = Date.now();
      if (published !== settledRef) {
        settledRef = published;
        settledAt = now;
      } else if (
        published.version === null &&
        now - settledAt >= settleMs &&
        !isProvisionalColdPublish(
          client,
          published,
          expectedDocumentVersion,
          now,
        )
      ) {
        return { confirmed: true, items: published.diagnostics };
      }
    }

    const pollMs = Math.min(
      DIAGNOSTICS_POLL_MS,
      Math.max(0, deadline - Date.now()),
    );
    if (!pullResultPromise) {
      await sleep(pollMs);
      continue;
    }
    const pullResult = await Promise.race([
      pullResultPromise,
      sleep(pollMs).then(() => undefined),
    ]);
    if (pullResult) {
      pullResultPromise = undefined;
      if (pullResult.diagnostics !== undefined) {
        pulled = pullResult.diagnostics;
        break;
      }
      if (pullResult.failed !== undefined) {
        // A pull failure leaves the report unknown, but a dual-mode server
        // may still publish fresh diagnostics within the remaining budget.
        pullFailure = pullResult.failed;
      }
    }
  }

  const versionOk =
    minVersion === undefined || client.diagnosticsVersion > minVersion;
  const published = client.diagnostics.get(uri);
  if (
    published &&
    versionOk &&
    !pullResultPromise &&
    pulled === undefined &&
    (!pullAttempted || published !== initialPublished)
  ) {
    if (
      expectedDocumentVersion !== undefined &&
      published.version === expectedDocumentVersion
    ) {
      return { confirmed: true, items: published.diagnostics };
    }
    const now = Date.now();
    if (
      published === settledRef &&
      published.version === null &&
      now - settledAt >= settleMs &&
      !isProvisionalColdPublish(client, published, expectedDocumentVersion, now)
    ) {
      return { confirmed: true, items: published.diagnostics };
    }
  }
  if (pullResultPromise) {
    const outcome = await pullResultPromise;
    if (outcome.diagnostics !== undefined) pulled = outcome.diagnostics;
    else if (outcome.failed !== undefined) pullFailure = outcome.failed;
  }
  throwIfAborted(signal);
  if (pulled === undefined) {
    // A failed pull (timeout/RPC error) leaves the file's state unknown; never
    // let it collapse into a clean empty result the caller renders as "OK".
    if (pullFailure !== undefined) {
      throw pullFailure instanceof Error
        ? pullFailure
        : new Error(String(pullFailure));
    }
    return { confirmed: false, items: [] };
  }
  client.diagnostics.set(uri, {
    diagnostics: pulled,
    version:
      expectedDocumentVersion ?? client.openFiles.get(uri)?.version ?? null,
  });
  client.diagnosticsVersion += 1;
  return { confirmed: true, items: pulled };
}
