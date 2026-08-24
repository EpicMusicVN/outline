import * as frames from "./frames";
import {
  cancelNotification,
  classifyFrame,
  initializeRequest,
  newSessionRequest,
  parsePromptComplete,
  promptRequest,
} from "./frames";

const sessionId = "agent:test:1";

describe("classifyFrame", () => {
  it("should classify an agent_message_chunk with text content as a delta", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({ kind: "delta", text: "Hello" });
  });

  it("should classify an agent_thought_chunk as a thought and never as a delta", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "reasoning" },
        },
      },
    });
    const classification = classifyFrame(raw, sessionId);
    expect(classification).toEqual({ kind: "thought", text: "reasoning" });
    expect(classification.kind).not.toBe("delta");
  });

  it("should ignore non-text content blocks", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", data: "base64" },
        },
      },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({ kind: "ignore" });
  });

  it("should ignore unknown sessionUpdate variants for forward compatibility", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          content: { type: "text", text: "x" },
        },
      },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({ kind: "ignore" });
  });

  it("should ignore updates for a foreign session", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "agent:other:2",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "x" },
        },
      },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({ kind: "ignore" });
  });

  it("should classify an inbound request frame with its id preserved", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: { options: [{ optionId: "a", name: "Approve", kind: "approve" }] },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({
      kind: "request",
      id: 7,
      method: "session/request_permission",
      params: { options: [{ optionId: "a", name: "Approve", kind: "approve" }] },
    });
  });

  it("should classify a response frame with its result", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { sessionId: "agent:1" },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({
      kind: "response",
      id: 3,
      result: { sessionId: "agent:1" },
    });
  });

  it("should classify a JSON-RPC error response with code and message", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "agent exploded" },
    });
    expect(classifyFrame(raw, sessionId)).toEqual({
      kind: "rpcError",
      id: 3,
      code: -32000,
      message: "agent exploded",
    });
  });

  it("should return malformed for unparseable input without throwing", () => {
    expect(() => classifyFrame("{", sessionId)).not.toThrow();
    expect(classifyFrame("{", sessionId)).toEqual({
      kind: "malformed",
      reason: "invalid JSON",
    });
  });

  it("should return malformed for a frame that is not an object", () => {
    expect(classifyFrame("[1,2]", sessionId)).toEqual({
      kind: "malformed",
      reason: "frame is not an object",
    });
  });
});

describe("frame builders", () => {
  it("should build an initialize request with the pinned protocol fields", () => {
    expect(initializeRequest(1)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: frames.PROTOCOL_VERSION,
        info: frames.CLIENT_INFO,
        capabilities: { loadSession: false },
      },
    });
  });

  it("should build a session/new request with cwd and mcpServers", () => {
    expect(newSessionRequest(2)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: "", mcpServers: [] },
    });
  });

  it("should build a session/prompt request with the session id and text content", () => {
    expect(promptRequest(3, "agent:unusual-42", "hello")).toEqual({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: {
        sessionId: "agent:unusual-42",
        prompt: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("should build a session/cancel notification without an id", () => {
    const frame = cancelNotification("agent:1");
    expect(frame.method).toBe("session/cancel");
    expect("id" in frame).toBe(false);
    expect(frame.params).toEqual({ sessionId: "agent:1" });
  });

  it("should never emit session/load or session/request_permission", () => {
    const built = [
      initializeRequest(1),
      newSessionRequest(2),
      promptRequest(3, "agent:1", "t"),
      cancelNotification("agent:1"),
    ];
    for (const frame of built) {
      const serialized = JSON.stringify(frame);
      expect(serialized).not.toContain("session/load");
      expect(serialized).not.toContain("session/request_permission");
    }
  });

  it("should not export a permission deny or session load builder", () => {
    expect("permissionDenyResponse" in frames).toBe(false);
    expect("loadSessionRequest" in frames).toBe(false);
  });
});

describe("parsePromptComplete", () => {
  it("should parse a prompt_complete update with its stop reason", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "prompt_complete",
          stopReason: "end_turn",
          content: [],
        },
      },
    });
    expect(parsePromptComplete(raw, sessionId)).toEqual({
      stopReason: "end_turn",
    });
  });

  it("should default the stop reason when absent", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update: { sessionUpdate: "prompt_complete" } },
    });
    expect(parsePromptComplete(raw, sessionId)).toEqual({
      stopReason: "end_turn",
    });
  });

  it("should return null for malformed input, foreign sessions, and non-complete updates", () => {
    expect(parsePromptComplete("not json", sessionId)).toBeNull();
    expect(
      parsePromptComplete(
        JSON.stringify({ jsonrpc: "2.0", method: "other" }),
        sessionId
      )
    ).toBeNull();
    const foreign = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "agent:other",
        update: { sessionUpdate: "prompt_complete" },
      },
    });
    expect(parsePromptComplete(foreign, sessionId)).toBeNull();
    const chunk = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "x" },
        },
      },
    });
    expect(parsePromptComplete(chunk, sessionId)).toBeNull();
  });
});
