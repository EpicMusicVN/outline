export const PROTOCOL_VERSION = "2025-06-30";
export const CLIENT_IDENTIFIER = "outline-emvn-ai";
export const CLIENT_VERSION = "1";
export const CLIENT_INFO = Object.freeze({
  identifier: CLIENT_IDENTIFIER,
  version: CLIENT_VERSION,
});
export const NEW_SESSION_CWD = "";
export const NEW_SESSION_MCP_SERVERS = Object.freeze([]);

export type JsonRpcRequestFrame = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

export type JsonRpcNotificationFrame = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export function initializeRequest(id: number): JsonRpcRequestFrame {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      info: CLIENT_INFO,
      capabilities: { loadSession: false },
    },
  };
}

export function newSessionRequest(id: number): JsonRpcRequestFrame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: {
      cwd: NEW_SESSION_CWD,
      mcpServers: NEW_SESSION_MCP_SERVERS,
    },
  };
}

export function promptRequest(
  id: number,
  sessionId: string,
  text: string
): JsonRpcRequestFrame {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [{ type: "text", text }],
    },
  };
}

export function cancelNotification(sessionId: string): JsonRpcNotificationFrame {
  return {
    jsonrpc: "2.0",
    method: "session/cancel",
    params: { sessionId },
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type FrameClassification =
  | { kind: "response"; id: number; result: unknown }
  | { kind: "rpcError"; id: number; code: number; message: string }
  | { kind: "delta"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "request"; id: number; method: string; params: unknown }
  | { kind: "ignore" }
  | { kind: "malformed"; reason: string };

export function classifyFrame(
  raw: string,
  sessionId: string
): FrameClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "malformed", reason: "invalid JSON" };
  }
  if (!isObject(parsed)) {
    return { kind: "malformed", reason: "frame is not an object" };
  }
  const frame = parsed;
  const method = frame.method;
  const id = frame.id;
  const hasMethod = typeof method === "string";
  const hasNumericId = typeof id === "number";

  if (hasMethod && hasNumericId) {
    return { kind: "request", id, method, params: frame.params };
  }
  if (hasNumericId) {
    if ("result" in frame) {
      return { kind: "response", id, result: frame.result };
    }
    if (
      isObject(frame.error) &&
      typeof frame.error.code === "number" &&
      typeof frame.error.message === "string"
    ) {
      return {
        kind: "rpcError",
        id,
        code: frame.error.code,
        message: frame.error.message,
      };
    }
    return { kind: "malformed", reason: "response without a result or error" };
  }
  if (hasMethod) {
    if (method !== "session/update") {
      return { kind: "ignore" };
    }
    const params = frame.params;
    if (!isObject(params) || params.sessionId !== sessionId) {
      return { kind: "ignore" };
    }
    const update = params.update;
    if (!isObject(update)) {
      return { kind: "ignore" };
    }
    const content = update.content;
    const text =
      isObject(content) &&
      content.type === "text" &&
      typeof content.text === "string"
        ? content.text
        : undefined;
    if (update.sessionUpdate === "agent_message_chunk") {
      return text === undefined
        ? { kind: "ignore" }
        : { kind: "delta", text };
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      return text === undefined
        ? { kind: "ignore" }
        : { kind: "thought", text };
    }
    return { kind: "ignore" };
  }
  return { kind: "malformed", reason: "frame has no method or id" };
}

export type PromptComplete = { stopReason: string };

export function parsePromptComplete(
  raw: string,
  sessionId: string
): PromptComplete | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.method !== "session/update") {
    return null;
  }
  const params = parsed.params;
  if (!isObject(params) || params.sessionId !== sessionId) {
    return null;
  }
  const update = params.update;
  if (!isObject(update) || update.sessionUpdate !== "prompt_complete") {
    return null;
  }
  const stopReason =
    typeof update.stopReason === "string" ? update.stopReason : "end_turn";
  return { stopReason };
}
