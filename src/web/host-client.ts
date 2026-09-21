import { WebSocket, type RawData } from "ws";

export interface HostClientOptions {
  url: string;
  token?: string;
  onUnavailable?: (error: Error) => void;
}

/** Small adapter for one Web Server ↔ Host connection. */
export class HostClient {
  private readonly options: HostClientOptions;
  private socket?: WebSocket;
  private intentionalClose = false;
  private ready = false;
  private readonly listeners = new Set<(data: RawData, isBinary: boolean) => void>();

  constructor(options: HostClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const headers = this.options.token === undefined
      ? undefined
      : { Authorization: `Bearer ${this.options.token}` };
    const socket = new WebSocket(this.options.url, headers === undefined ? undefined : { headers });
    this.socket = socket;
    this.intentionalClose = false;
    socket.on("message", (data: RawData, isBinary: boolean) => {
      for (const listener of this.listeners) listener(data, isBinary);
    });
    socket.on("error", (error) => {
      if (this.ready && !this.intentionalClose) {
        this.options.onUnavailable?.(error instanceof Error ? error : new Error("Host socket error"));
      }
    });
    socket.on("close", () => {
      if (this.ready && !this.intentionalClose) this.options.onUnavailable?.(new Error("Host connection closed"));
    });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Host connection closed before opening"));
      };
      const cleanup = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
    this.ready = true;
  }

  send(data: RawData | string, isBinary = false): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Host connection is not open");
    }
    this.socket.send(data, { binary: isBinary });
  }

  onFrame(listener: (data: RawData, isBinary: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.intentionalClose = true;
    this.ready = false;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  }
}
