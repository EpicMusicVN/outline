import * as React from "react";
import { CSRF } from "@shared/constants";
import { getCSRFToken } from "~/utils/csrf";
import type { AICommandRequest } from "../../shared/types";
import type { StreamState } from "../accumulate";
import { accumulate, createInitialStreamState } from "../accumulate";
import { createSSEParser } from "../sse/parseSSE";

/** Shape of the JSON error body for both pre-stream failures (auth, validation, policy, mint/connect) and network errors. */
type ErrorBody = {
  message?: string;
  error?: string;
};

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body: ErrorBody = await res.json();
    if (body.message) {
      return body.message;
    }
  } catch {
    // The body wasn't JSON — fall through to the generic message below.
  }
  return `Request failed with status ${res.status}`;
}

export type UseAICommandStreamResult = {
  state: StreamState;
  /** Starts a new command, aborting any request already in flight. */
  start: (request: AICommandRequest) => void;
  /**
   * Aborts the in-flight request. The fetch closing is what propagates
   * cancellation to the server (`req.on("close")` → `session/cancel`) — this
   * function must not do anything beyond `abort()` that could race that.
   * If a stream was still in progress, the partial result is kept and the
   * phase moves to `complete`, mirroring a server `done` event, so the panel
   * can still offer Accept/Insert/Copy on what was generated so far.
   */
  cancel: () => void;
};

export function useAICommandStream(): UseAICommandStreamResult {
  const [state, setState] = React.useState<StreamState>(createInitialStreamState);
  const pendingRef = React.useRef<StreamState>(createInitialStreamState());
  const controllerRef = React.useRef<AbortController | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(true);

  const applyPending = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (mountedRef.current) {
      setState(pendingRef.current);
    }
  }, []);

  const scheduleFlush = React.useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (mountedRef.current) {
        setState(pendingRef.current);
      }
    });
  }, []);

  const cancel = React.useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort();
    if (pendingRef.current.phase === "streaming") {
      pendingRef.current = accumulate(pendingRef.current, {
        type: "done",
        stopReason: "cancelled",
      });
    }
    applyPending();
  }, [applyPending]);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
      cancel();
    },
    [cancel]
  );

  const start = React.useCallback(
    (request: AICommandRequest) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      pendingRef.current = createInitialStreamState();
      setState(pendingRef.current);

      void (async () => {
        let res: Response;
        try {
          res = await fetch("/api/emvnAi.command", {
            method: "POST",
            credentials: "same-origin",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              [CSRF.headerName]: getCSRFToken(),
            },
            body: JSON.stringify(request),
          });
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }
          pendingRef.current = {
            ...pendingRef.current,
            phase: "failed",
            message: err instanceof Error ? err.message : "Network error",
          };
          applyPending();
          return;
        }

        if (!res.ok) {
          const message = await readErrorMessage(res);
          if (controller.signal.aborted) {
            return;
          }
          pendingRef.current = { ...pendingRef.current, phase: "failed", message };
          applyPending();
          return;
        }

        const parse = createSSEParser();

        if (!res.body) {
          // Very old browsers without a streaming response body: read the
          // whole buffer at once and parse it as a single chunk. Correct,
          // just not incremental.
          const text = await res.text();
          for (const event of parse(text)) {
            pendingRef.current = accumulate(pendingRef.current, event);
          }
          applyPending();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            const chunk = decoder.decode(value, { stream: true });
            for (const event of parse(chunk)) {
              pendingRef.current = accumulate(pendingRef.current, event);
            }
            scheduleFlush();
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            pendingRef.current = {
              ...pendingRef.current,
              phase: "failed",
              message: err instanceof Error ? err.message : "Stream error",
            };
          }
        } finally {
          applyPending();
        }
      })();
    },
    [applyPending, scheduleFlush]
  );

  return { state, start, cancel };
}
