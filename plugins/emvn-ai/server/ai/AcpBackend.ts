import Logger from "@server/logging/Logger";
import type { AIStreamEvent } from "../../shared/types";
import {
  cancelNotification,
  classifyFrame,
  initializeRequest,
  isObject,
  newSessionRequest,
  parsePromptComplete,
  promptRequest,
} from "../acp/frames";
import {
  JsonRpcWebSocket,
  METHOD_NOT_FOUND,
} from "../acp/JsonRpcWebSocket";
import type { SocketFactory } from "../acp/JsonRpcWebSocket";
import { mintChatToken } from "../acp/mint";
import type { AIBackend, AIRequest } from "./AIBackend";

export const AI_REQUEST_TIMEOUT_MS = 90_000;

export type AcpBackendOptions = {
  socketFactory?: SocketFactory;
  mint?: typeof mintChatToken;
  requestTimeoutMs?: number;
};

export class AcpBackend implements AIBackend {
  public constructor(private readonly options: AcpBackendOptions = {}) {}

  public async *stream(
    request: AIRequest,
    options: { signal: AbortSignal }
  ): AsyncIterable<AIStreamEvent> {
    const target = request.target;
    const mint = this.options.mint ?? mintChatToken;
    const timeoutMs = this.options.requestTimeoutMs ?? AI_REQUEST_TIMEOUT_MS;

    const { token, wsUrl } = await mint(target, options.signal);

    let sessionId = "";
    let terminal: AIStreamEvent | undefined;
    const events: AIStreamEvent[] = [];
    const waiters: Array<(event: AIStreamEvent) => void> = [];

    const emit = (event: AIStreamEvent): void => {
      if (terminal) {
        return;
      }
      const waiter = waiters.shift();
      if (waiter) {
        waiter(event);
      } else {
        events.push(event);
      }
    };

    const endWith = (event: AIStreamEvent): void => {
      if (terminal) {
        return;
      }
      terminal = event;
      Logger.info(
        "plugins",
        event.type === "done" ? "Agent turn complete" : "Agent request failed",
        event.type === "done"
          ? {
              requestId: request.requestId,
              targetId: target.id,
              stopReason: event.stopReason,
            }
          : {
              requestId: request.requestId,
              targetId: target.id,
              reason: event.message,
            }
      );
      for (const waiter of waiters.splice(0)) {
        waiter(event);
      }
    };

    const socket = new JsonRpcWebSocket(
      wsUrl,
      token,
      target.instanceId,
      {
        onNotification: (raw: string) => {
          if (terminal) {
            return;
          }
          const complete = parsePromptComplete(raw, sessionId);
          if (complete) {
            endWith({ type: "done", stopReason: complete.stopReason });
            return;
          }
          const classification = classifyFrame(raw, sessionId);
          if (classification.kind === "delta") {
            emit({ type: "delta", text: classification.text });
          } else if (classification.kind === "thought") {
            emit({ type: "thought", text: classification.text });
          }
        },
        onRequest: () => ({ error: METHOD_NOT_FOUND }),
        onClose: () => {
          if (terminal) {
            return;
          }
          endWith({ type: "error", message: "Agent connection closed" });
        },
      },
      { socketFactory: this.options.socketFactory }
    );

    Logger.info("plugins", "Minted ACP chat token", {
      requestId: request.requestId,
      targetId: target.id,
    });

    const signal = options.signal;
    const onAbort = (): void => {
      if (terminal) {
        return;
      }
      if (sessionId) {
        socket.notify(cancelNotification(sessionId));
      }
      endWith({ type: "error", message: "Request aborted" });
      socket.close();
    };

    const deadline = setTimeout(() => {
      if (terminal) {
        return;
      }
      if (sessionId) {
        socket.notify(cancelNotification(sessionId));
      }
      endWith({ type: "error", message: "Agent request timed out" });
      socket.close();
    }, timeoutMs);

    try {
      await socket.connect();

      Logger.info("plugins", "Connected to agent socket", {
        requestId: request.requestId,
        targetId: target.id,
      });

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort);
      }

      try {
        const initResult = await socket.request(
          initializeRequest(socket.nextId())
        );
        if (!reportsLoadSessionFalse(initResult)) {
          endWith({
            type: "error",
            message: "Agent does not support the required session model",
          });
        }
      } catch (error) {
        endWith(toEventError(error));
      }

      if (!terminal) {
        try {
          const newResult = await socket.request(
            newSessionRequest(socket.nextId())
          );
          sessionId = adoptSessionId(newResult);
          if (!sessionId) {
            endWith({
              type: "error",
              message: "Agent did not return a session id",
            });
          }
        } catch (error) {
          endWith(toEventError(error));
        }
      }

      if (!terminal) {
        try {
          await socket.request(
            promptRequest(socket.nextId(), sessionId, request.prompt)
          );
        } catch (error) {
          endWith(toEventError(error));
        }
      }

      for (;;) {
        if (events.length > 0) {
          yield events.shift()!;
          continue;
        }
        if (terminal) {
          yield terminal;
          return;
        }
        const event = await new Promise<AIStreamEvent>((resolve) =>
          waiters.push(resolve)
        );
        yield event;
        if (event === terminal) {
          return;
        }
      }
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", onAbort);
      socket.close();
    }
  }
}

function reportsLoadSessionFalse(result: unknown): boolean {
  if (!isObject(result)) {
    return false;
  }
  const capabilities = result.capabilities;
  return isObject(capabilities) && capabilities.loadSession === false;
}

function adoptSessionId(result: unknown): string {
  if (!isObject(result)) {
    return "";
  }
  const sessionId = result.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : "";
}

function toEventError(error: unknown): AIStreamEvent {
  return {
    type: "error",
    message: error instanceof Error ? error.message : "Agent request failed",
  };
}
