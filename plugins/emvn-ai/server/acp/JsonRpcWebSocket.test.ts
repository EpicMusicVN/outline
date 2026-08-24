import {
  JsonRpcWebSocket,
  METHOD_NOT_FOUND_CODE,
  RpcError,
} from "./JsonRpcWebSocket";
import type { JsonRpcSocketTransport, SocketHandlers } from "./JsonRpcWebSocket";
import type { JsonRpcRequestFrame } from "./frames";

class FakeSocket implements JsonRpcSocketTransport {
  public readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  public readonly sent: string[] = [];
  public closed = false;
  private readonly autoOpen: boolean;

  public constructor(autoOpen = false) {
    this.autoOpen = autoOpen;
    if (autoOpen) {
      queueMicrotask(() => this.emit("open"));
    }
  }

  public on(
    event: "open" | "message" | "error" | "close",
    listener: (...args: unknown[]) => void
  ): void {
    (this.listeners[event] ??= []).push(listener);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.emit("close", 1000, "");
  }

  public emit(event: string, ...args: unknown[]): void {
    if (event === "close") {
      this.closed = true;
    }
    for (const listener of this.listeners[event] ?? []) {
      listener(...args);
    }
  }
}

const requestFrame = (
  id: number,
  method: string,
  params?: unknown
): JsonRpcRequestFrame => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

const connectSocket = async (
  handlers: SocketHandlers = {},
  autoOpen = true
) => {
  const fake = new FakeSocket(autoOpen);
  const socketFactory = vi.fn((_url: string) => fake);
  const socket = new JsonRpcWebSocket(
    "wss://hub.example.com/ws/chat",
    "minted-token",
    "inst-1",
    handlers,
    { socketFactory }
  );
  await socket.connect();
  return { fake, socket, socketFactory };
};

describe("JsonRpcWebSocket", () => {
  it("should connect with the minted token and agent id as query parameters", async () => {
    const fake = new FakeSocket(true);
    const socketFactory = vi.fn((_url: string) => fake);
    const socket = new JsonRpcWebSocket(
      "wss://hub.example.com/ws/chat",
      "minted-token",
      "inst-1",
      {},
      { socketFactory }
    );
    await socket.connect();
    expect(socketFactory).toHaveBeenCalledWith(
      "wss://hub.example.com/ws/chat?token=minted-token&agentId=inst-1"
    );
  });

  it("should hand out monotonically increasing request ids", async () => {
    const { socket } = await connectSocket();
    expect(socket.nextId()).toBe(1);
    expect(socket.nextId()).toBe(2);
    expect(socket.nextId()).toBe(3);
  });

  it("should correlate responses with their requests across interleaved ids", async () => {
    const { fake, socket } = await connectSocket();
    const first = socket.request(requestFrame(1, "a"));
    const second = socket.request(requestFrame(2, "b"));
    fake.emit("message", JSON.stringify({ jsonrpc: "2.0", id: 2, result: "second" }));
    fake.emit("message", JSON.stringify({ jsonrpc: "2.0", id: 1, result: "first" }));
    await expect(second).resolves.toBe("second");
    await expect(first).resolves.toBe("first");
  });

  it("should reject a pending request with an RpcError on a JSON-RPC error response", async () => {
    const { fake, socket } = await connectSocket();
    const pending = socket.request(requestFrame(3, "m"));
    fake.emit(
      "message",
      JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "agent exploded" } })
    );
    await expect(pending).rejects.toBeInstanceOf(RpcError);
    await expect(pending).rejects.toMatchObject({
      code: -32000,
      message: "agent exploded",
    });
  });

  it("should dispatch inbound requests and write the reply with the same id", async () => {
    const onRequest = vi.fn(() => ({
      error: { code: METHOD_NOT_FOUND_CODE, message: "Method not found" },
    }));
    const { fake } = await connectSocket({ onRequest });
    fake.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "session/request_permission",
        params: { options: [] },
      })
    );
    expect(onRequest).toHaveBeenCalledWith(
      "session/request_permission",
      { options: [] },
      7
    );
    const reply = JSON.parse(fake.sent.at(-1)!) as Record<string, unknown>;
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: METHOD_NOT_FOUND_CODE, message: "Method not found" },
    });
  });

  it("should answer an inbound request with method-not-found when no handler is registered", async () => {
    const { fake } = await connectSocket();
    fake.emit(
      "message",
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "unknown.method", params: {} })
    );
    const reply = JSON.parse(fake.sent.at(-1)!) as Record<string, unknown>;
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 8,
      error: { code: METHOD_NOT_FOUND_CODE, message: "Method not found" },
    });
  });

  it("should fan out notifications without resolving a pending request", async () => {
    const onNotification = vi.fn();
    const { fake, socket } = await connectSocket({ onNotification });
    const rawNotification = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s" },
    });
    const pending = socket.request(requestFrame(5, "m"));
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    fake.emit("message", rawNotification);
    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith(rawNotification);
    expect(settled).toBe(false);
    fake.emit("message", JSON.stringify({ jsonrpc: "2.0", id: 5, result: "ok" }));
    await expect(pending).resolves.toBe("ok");
  });

  it("should reject in-flight requests when closed and be idempotent", async () => {
    const { fake, socket } = await connectSocket();
    const pending = socket.request(requestFrame(9, "m"));
    socket.close();
    socket.close();
    await expect(pending).rejects.toThrow("Socket closed");
    expect(fake.closed).toBe(true);
  });

  it("should reject the connect promise when the socket errors before opening", async () => {
    const fake = new FakeSocket(false);
    const socket = new JsonRpcWebSocket(
      "wss://x/chat",
      "t",
      "i",
      {},
      { socketFactory: vi.fn(() => fake) }
    );
    const connecting = socket.connect();
    fake.emit("error", new Error("connection refused"));
    await expect(connecting).rejects.toThrow("connection refused");
  });

  it("should report peer close through the onClose handler", async () => {
    const onClose = vi.fn();
    const { fake } = await connectSocket({ onClose });
    fake.emit("close", 1006, "");
    expect(onClose).toHaveBeenCalledWith(1006, "");
  });
});
