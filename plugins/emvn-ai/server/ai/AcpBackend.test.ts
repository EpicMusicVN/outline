import { AcpBackend } from "./AcpBackend";
import type { AIRequest } from "./AIBackend";
import { MintError } from "../acp/mint";
import type { JsonRpcSocketTransport } from "../acp/JsonRpcWebSocket";
import type { AIStreamEvent } from "../../shared/types";

const UNUSUAL_SESSION_ID = "agent:unusual-42/𝕏-xyz";

const target = { id: "writer", label: "Writer", instanceId: "inst-1" };

const request: AIRequest = {
  prompt: "Explain quantum computing.",
  target,
  requestId: "req-1",
};

class FakeSocket implements JsonRpcSocketTransport {
  public readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  public readonly sent: string[] = [];
  public closed = false;

  public on(
    event: "open" | "message" | "error" | "close",
    listener: (...args: unknown[]) => void
  ): void {
    (this.listeners[event] ??= []).push(listener);
    if (event === "open") {
      queueMicrotask(() => this.emit("open"));
    }
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

type SentFrame = { id?: number; method?: string; params?: unknown };

const sentFrames = (fake: FakeSocket): SentFrame[] =>
  fake.sent.map((raw) => JSON.parse(raw) as SentFrame);

const makeHarness = (options: { requestTimeoutMs?: number } = {}) => {
  const fake = new FakeSocket();
  const socketFactory = vi.fn((_url: string) => fake);
  const mint = vi.fn(async () => ({
    token: "minted-token",
    wsUrl: "wss://hub.example.com/ws/chat",
  }));
  const backend = new AcpBackend({ socketFactory, mint, ...options });
  return { backend, fake, mint, socketFactory };
};

const streamRequest = (
  backend: AcpBackend,
  signal: AbortSignal,
  collected: AIStreamEvent[] = []
) => {
  const done = (async () => {
    for await (const event of backend.stream(request, { signal })) {
      collected.push(event);
    }
  })();
  return { done, collected };
};

const initializeResponse = (id: number) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2025-06-30",
      info: { identifier: "hub", version: "1" },
      capabilities: { loadSession: false },
    },
  });

const newSessionResponse = (id: number, sessionId: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { sessionId },
  });

const promptAck = (id: number) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { sessionId: UNUSUAL_SESSION_ID },
  });

const sessionUpdate = (
  sessionUpdate: string,
  content: unknown,
  stopReason?: string
) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: UNUSUAL_SESSION_ID,
      update: {
        sessionUpdate,
        ...(stopReason ? { stopReason } : {}),
        content,
      },
    },
  });

const driveHandshake = async (fake: FakeSocket) => {
  await vi.waitFor(() => expect(fake.sent.length).toBe(1));
  fake.emit("message", initializeResponse(1));
  await vi.waitFor(() => expect(fake.sent.length).toBe(2));
  fake.emit("message", newSessionResponse(2, UNUSUAL_SESSION_ID));
  await vi.waitFor(() => expect(fake.sent.length).toBe(3));
  fake.emit("message", promptAck(3));
};

describe("AcpBackend", () => {
  it("should handshake in order, adopt the session id verbatim, and finish on prompt_complete", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);

    await vi.waitFor(() => expect(fake.sent.length).toBe(1));
    const frames = sentFrames(fake);
    expect(frames[0]!.method).toBe("initialize");
    const initParams = frames[0]!.params as Record<string, unknown>;
    expect(initParams.capabilities).toEqual({ loadSession: false });
    fake.emit("message", initializeResponse(1));

    await vi.waitFor(() => expect(fake.sent.length).toBe(2));
    expect(sentFrames(fake)[1]!.method).toBe("session/new");
    expect(sentFrames(fake)[1]!.params).toEqual({ cwd: "", mcpServers: [] });
    fake.emit("message", newSessionResponse(2, UNUSUAL_SESSION_ID));

    await vi.waitFor(() => expect(fake.sent.length).toBe(3));
    const promptFrame = sentFrames(fake)[2]!;
    expect(promptFrame.method).toBe("session/prompt");
    const promptParams = promptFrame.params as Record<string, unknown>;
    expect(promptParams.sessionId).toBe(UNUSUAL_SESSION_ID);
    expect(promptParams.prompt).toEqual([
      { type: "text", text: request.prompt },
    ]);
    fake.emit("message", promptAck(3));

    // The fast ack alone must not finish the turn.
    fake.emit("message", sessionUpdate("agent_message_chunk", { type: "text", text: "Hello" }));
    fake.emit("message", sessionUpdate("agent_thought_chunk", { type: "text", text: "reasoning" }));
    fake.emit("message", sessionUpdate("agent_message_chunk", { type: "text", text: " world" }));

    await vi.waitFor(() => expect(collected.length).toBe(3));
    expect(collected.map((event) => event.type)).toEqual(["delta", "thought", "delta"]);
    expect(collected.some((event) => event.type === "done")).toBe(false);

    fake.emit("message", sessionUpdate("prompt_complete", [], "end_turn"));
    await done;

    expect(collected).toEqual([
      { type: "delta", text: "Hello" },
      { type: "thought", text: "reasoning" },
      { type: "delta", text: " world" },
      { type: "done", stopReason: "end_turn" },
    ]);
    expect(fake.closed).toBe(true);
  });

  it("should fail the request when initialize does not report loadSession:false", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);

    await vi.waitFor(() => expect(fake.sent.length).toBe(1));
    fake.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-30",
          info: { identifier: "hub", version: "1" },
          capabilities: { loadSession: true },
        },
      })
    );
    await done;

    expect(collected).toEqual([
      { type: "error", message: "Agent does not support the required session model" },
    ]);
    expect(fake.sent.length).toBe(1);
    expect(fake.closed).toBe(true);
  });

  it("should fail when session/new returns no usable session id and never send the prompt", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);

    await vi.waitFor(() => expect(fake.sent.length).toBe(1));
    fake.emit("message", initializeResponse(1));
    await vi.waitFor(() => expect(fake.sent.length).toBe(2));
    fake.emit("message", newSessionResponse(2, ""));
    await done;

    expect(collected).toEqual([
      { type: "error", message: "Agent did not return a session id" },
    ]);
    expect(fake.sent.length).toBe(2);
    expect(fake.closed).toBe(true);
  });

  it("should surface a JSON-RPC error during the handshake as an error event", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);

    await vi.waitFor(() => expect(fake.sent.length).toBe(1));
    fake.emit(
      "message",
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "agent exploded" } })
    );
    await done;

    expect(collected).toEqual([{ type: "error", message: "agent exploded" }]);
    expect(fake.closed).toBe(true);
  });

  it("should answer unexpected inbound requests with method-not-found and never dispatch a permission request", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);
    await driveHandshake(fake);

    fake.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "session/request_permission",
        params: { options: [{ optionId: "a", name: "Approve", kind: "approve" }] },
      })
    );

    await vi.waitFor(() => expect(fake.sent.length).toBe(4));
    expect(sentFrames(fake)[3]).toEqual({
      jsonrpc: "2.0",
      id: 99,
      error: { code: -32601, message: "Method not found" },
    });

    for (const frame of sentFrames(fake)) {
      expect(frame.method).not.toBe("session/request_permission");
      expect(frame.method).not.toBe("session/load");
    }

    fake.emit("message", sessionUpdate("agent_message_chunk", { type: "text", text: "ok" }));
    fake.emit("message", sessionUpdate("prompt_complete", [], "end_turn"));
    await done;

    expect(collected).toEqual([
      { type: "delta", text: "ok" },
      { type: "done", stopReason: "end_turn" },
    ]);
    expect(fake.closed).toBe(true);
  });

  it("should send session/cancel and close when the request is aborted", async () => {
    const { backend, fake } = makeHarness();
    const controller = new AbortController();
    const { done, collected } = streamRequest(backend, controller.signal);
    await driveHandshake(fake);

    controller.abort();
    await done;

    const cancelFrame = sentFrames(fake).at(-1)!;
    expect(cancelFrame).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: UNUSUAL_SESSION_ID },
    });
    expect(cancelFrame.id).toBeUndefined();
    expect(collected).toEqual([{ type: "error", message: "Request aborted" }]);
    expect(fake.closed).toBe(true);
  });

  it("should send session/cancel and an error event when the request deadline passes", async () => {
    const { backend, fake } = makeHarness({ requestTimeoutMs: 300 });
    const { done, collected } = streamRequest(backend, new AbortController().signal);
    await driveHandshake(fake);

    await done;

    const cancelFrame = sentFrames(fake).at(-1)!;
    expect(cancelFrame.method).toBe("session/cancel");
    expect(cancelFrame.id).toBeUndefined();
    expect(cancelFrame.params).toEqual({ sessionId: UNUSUAL_SESSION_ID });
    expect(collected).toEqual([{ type: "error", message: "Agent request timed out" }]);
    expect(fake.closed).toBe(true);
  });

  it("should surface an error event when the peer closes mid-stream", async () => {
    const { backend, fake } = makeHarness();
    const { done, collected } = streamRequest(backend, new AbortController().signal);
    await driveHandshake(fake);
    fake.emit("message", sessionUpdate("agent_message_chunk", { type: "text", text: "partial" }));

    await vi.waitFor(() => expect(collected.length).toBe(1));
    fake.emit("close", 1006, "");
    await done;

    expect(collected).toEqual([
      { type: "delta", text: "partial" },
      { type: "error", message: "Agent connection closed" },
    ]);
    expect(fake.closed).toBe(true);
  });

  it("should throw when minting fails, before any socket work", async () => {
    const { backend, mint, socketFactory } = makeHarness();
    mint.mockRejectedValue(new MintError("Mint request failed"));
    const { done, collected } = streamRequest(backend, new AbortController().signal);

    await expect(done).rejects.toThrow("Mint request failed");
    expect(collected).toEqual([]);
    expect(socketFactory).not.toHaveBeenCalled();
  });
});
