import WebSocket from "ws";
import { isObject } from "./frames";
import type { JsonRpcNotificationFrame, JsonRpcRequestFrame } from "./frames";

export const CONNECT_TIMEOUT_MS = 10_000;

export type JsonRpcError = { code: number; message: string };

export type RequestReply = { result?: unknown; error?: JsonRpcError };

export type JsonRpcReplyFrame = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
};

export const METHOD_NOT_FOUND_CODE = -32601;
export const METHOD_NOT_FOUND_MESSAGE = "Method not found";
export const METHOD_NOT_FOUND: JsonRpcError = {
  code: METHOD_NOT_FOUND_CODE,
  message: METHOD_NOT_FOUND_MESSAGE,
};

export type SocketHandlers = {
  onNotification?: (raw: string) => void;
  onRequest?: (method: string, params: unknown, id: number) => RequestReply | undefined;
  onClose?: (code: number, reason: string) => void;
};

export interface JsonRpcSocketTransport {
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  on(event: "close", listener: (code: number, reason: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => JsonRpcSocketTransport;

export class RpcError extends Error {
  public constructor(
    public readonly id: number,
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
};

export class JsonRpcWebSocket {
  private nextIdValue = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private socket: JsonRpcSocketTransport | undefined;
  private connectPromise: Promise<void> | undefined;
  private connectReject: ((error: unknown) => void) | undefined;
  private connectTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly socketFactory: SocketFactory;

  public constructor(
    private readonly wsUrl: string,
    private readonly token: string,
    private readonly agentId: string,
    private readonly handlers: SocketHandlers,
    options: { socketFactory?: SocketFactory } = {}
  ) {
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
  }

  public connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const url = new URL(this.wsUrl);
    url.searchParams.set("token", this.token);
    url.searchParams.set("agentId", this.agentId);
    const socket = this.socketFactory(url.toString());
    this.socket = socket;

    let resolveOpen!: () => void;
    let rejectOpen!: (error: unknown) => void;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    this.connectReject = rejectOpen;

    this.connectTimer = setTimeout(() => {
      if (this.closed) {
        return;
      }
      rejectOpen(
        new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS}ms`)
      );
      this.close();
    }, CONNECT_TIMEOUT_MS);

    socket.on("open", () => {
      if (this.closed) {
        return;
      }
      this.clearConnectTimer();
      resolveOpen();
    });
    socket.on("message", (data) => {
      this.onMessage(data);
    });
    socket.on("error", (error) => {
      if (this.closed) {
        return;
      }
      this.clearConnectTimer();
      rejectOpen(error);
    });
    socket.on("close", (code, reason) => {
      this.clearConnectTimer();
      this.onClose(code, reason);
    });

    return this.connectPromise;
  }

  public nextId(): number {
    const id = this.nextIdValue;
    this.nextIdValue += 1;
    return id;
  }

  public request(frame: JsonRpcRequestFrame): Promise<unknown> {
    if (this.closed || !this.socket) {
      return Promise.reject(new Error("Socket is not open"));
    }
    if (this.pending.has(frame.id)) {
      return Promise.reject(new Error(`Request ${frame.id} is already pending`));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(frame.id, { resolve, reject });
      try {
        this.socket!.send(JSON.stringify(frame));
      } catch (error) {
        this.pending.delete(frame.id);
        reject(error);
      }
    });
  }

  public notify(frame: JsonRpcNotificationFrame): void {
    if (this.closed || !this.socket) {
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearConnectTimer();
    const error = new Error("Socket closed");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.rejectConnect(error);
    this.socket?.close();
    this.socket = undefined;
  }

  private rejectConnect(error: unknown): void {
    if (this.connectReject) {
      this.connectReject(error);
      this.connectReject = undefined;
    }
    this.connectPromise = undefined;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
  }

  private onMessage(data: unknown): void {
    const raw = toText(data);
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(frame)) {
      return;
    }
    const method = frame.method;
    const id = frame.id;
    const hasMethod = typeof method === "string";
    const hasNumericId = typeof id === "number";

    if (hasMethod && hasNumericId) {
      this.sendFrame(this.answerRequest(method, frame.params, id));
      return;
    }
    if (hasNumericId) {
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      if ("error" in frame && isObject(frame.error)) {
        const error = frame.error;
        pending.reject(
          new RpcError(
            id,
            typeof error.code === "number" ? error.code : -32000,
            typeof error.message === "string" ? error.message : "RPC error"
          )
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if (hasMethod) {
      this.handlers.onNotification?.(raw);
    }
  }

  private answerRequest(
    method: string,
    params: unknown,
    id: number
  ): JsonRpcReplyFrame {
    let reply: RequestReply | undefined;
    try {
      reply = this.handlers.onRequest?.(method, params, id);
    } catch {
      reply = undefined;
    }
    if (reply && reply.error) {
      return { jsonrpc: "2.0", id, error: reply.error };
    }
    if (reply) {
      return { jsonrpc: "2.0", id, result: reply.result };
    }
    return { jsonrpc: "2.0", id, error: METHOD_NOT_FOUND };
  }

  private sendFrame(frame: JsonRpcReplyFrame): void {
    if (this.closed || !this.socket) {
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  private onClose(code: number, reason: unknown): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearConnectTimer();
    const error = new Error("Socket closed by peer");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.rejectConnect(error);
    this.handlers.onClose?.(code, String(reason));
    this.socket = undefined;
  }
}

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url);

function toText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return String(data);
}
