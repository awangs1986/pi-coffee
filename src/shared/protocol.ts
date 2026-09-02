/**
 * The deliberately small PI Coffee wire protocol.
 *
 * The browser and Host never exchange Pi implementation objects directly.  Pi
 * events are carried as JSON values so the Host adapter can be replaced later
 * (for example by the native Pi server package) without changing the Web
 * Server seam.
 */

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 64 * 1024;
export const MAX_REQUEST_ID_CHARS = 256;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface SessionState {
  isStreaming: boolean;
  messageCount: number;
  sessionName?: string;
}

export type ClientFrame =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "open";
      sessionId?: string;
      after?: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "prompt";
      requestId: string;
      text: string;
      images?: ImageInput[];
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "abort";
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ping";
      nonce: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "close";
    };

export type ServerFrame =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "opened";
      sessionId: string;
      cursor: number;
      state: SessionState;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "event";
      sessionId: string;
      cursor: number;
      event: JsonValue;
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ack";
      operation: "prompt" | "abort";
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "pong";
      nonce: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "error";
      code: string;
      message: string;
      requestId?: string;
      fatal?: boolean;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "resync_required";
      sessionId: string;
      oldestCursor: number;
      newestCursor: number;
    };

export function encodeFrame(frame: ServerFrame | ClientFrame): string {
  const encoded = JSON.stringify(frame);
  if (encoded === undefined) throw new Error("Frame is not JSON serializable");
  assertFrameSize(encoded);
  return encoded;
}

export function decodeClientFrame(input: string | Uint8Array): ClientFrame {
  const encoded = typeof input === "string" ? input : new TextDecoder().decode(input);
  assertFrameSize(encoded);

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ProtocolError("invalid_json", "Frame is not valid JSON");
  }

  if (!isRecord(value)) throw new ProtocolError("invalid_frame", "Frame must be a JSON object");
  if (value.v !== PROTOCOL_VERSION) {
    throw new ProtocolError("unsupported_version", `Unsupported protocol version: ${String(value.v)}`);
  }

  switch (value.type) {
    case "open":
      return parseOpen(value);
    case "prompt":
      return parsePrompt(value);
    case "abort":
      return parseAbort(value);
    case "ping":
      return parsePing(value);
    case "close":
      return { v: PROTOCOL_VERSION, type: "close" };
    default:
      throw new ProtocolError("unknown_type", "Unknown client frame type");
  }
}

export function decodeServerFrame(input: string | Uint8Array): ServerFrame {
  const encoded = typeof input === "string" ? input : new TextDecoder().decode(input);
  assertFrameSize(encoded);
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ProtocolError("invalid_json", "Frame is not valid JSON");
  }
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.type !== "string") {
    throw new ProtocolError("invalid_frame", "Invalid server frame");
  }
  // The Web Server only needs to validate the common envelope.  Event payloads
  // are intentionally opaque to this module and are validated by Pi adapters.
  return value as unknown as ServerFrame;
}

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function parseOpen(value: Record<string, unknown>): ClientFrame {
  const sessionId = optionalString(value.sessionId, "sessionId", 256);
  const after = optionalNonNegativeInteger(value.after, "after");
  return {
    v: PROTOCOL_VERSION,
    type: "open",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(after === undefined ? {} : { after }),
  };
}

function parsePrompt(value: Record<string, unknown>): ClientFrame {
  const requestId = requiredString(value.requestId, "requestId", MAX_REQUEST_ID_CHARS);
  const text = requiredString(value.text, "text", MAX_PROMPT_CHARS);
  const images = parseImages(value.images);
  return {
    v: PROTOCOL_VERSION,
    type: "prompt",
    requestId,
    text,
    ...(images === undefined ? {} : { images }),
  };
}

function parseAbort(value: Record<string, unknown>): ClientFrame {
  const requestId = optionalString(value.requestId, "requestId", MAX_REQUEST_ID_CHARS);
  return {
    v: PROTOCOL_VERSION,
    type: "abort",
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parsePing(value: Record<string, unknown>): ClientFrame {
  return { v: PROTOCOL_VERSION, type: "ping", nonce: requiredString(value.nonce, "nonce", 256) };
}

function parseImages(value: unknown): ImageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) {
    throw new ProtocolError("invalid_images", "images must be an array with at most 8 items");
  }
  return value.map((item, index) => {
    if (!isRecord(item) || item.type !== "image") {
      throw new ProtocolError("invalid_images", `images[${index}] must be an image object`);
    }
    const data = requiredString(item.data, `images[${index}].data`, MAX_FRAME_BYTES);
    const mimeType = requiredString(item.mimeType, `images[${index}].mimeType`, 128);
    return { type: "image", data, mimeType };
  });
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError("invalid_field", `${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new ProtocolError("invalid_field", `${field} is too long`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, maxLength);
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProtocolError("invalid_field", `${field} must be a non-negative integer`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFrameSize(encoded: string): void {
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (bytes > MAX_FRAME_BYTES) throw new ProtocolError("frame_too_large", "Frame is too large");
}
