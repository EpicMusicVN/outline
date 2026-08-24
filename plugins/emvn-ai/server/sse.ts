import type { ServerResponse } from "node:http";
import type { AIStreamEvent } from "../shared/types";

/**
 * A comment line, ignored by every SSE parser. Sent on an interval to defeat
 * idle proxy timeouts while the agent is thinking between chunks.
 */
export const HEARTBEAT = ": ping\n\n";

/**
 * Encode a single AI stream event as an SSE `data:` frame.
 *
 * JSON-encoding the whole event sidesteps every multi-line and CR/LF framing
 * hazard in the underlying text — never emit raw text after `data:`.
 *
 * @param event the event to encode.
 * @returns the frame, including the trailing blank line that terminates it.
 */
export function encodeEvent(event: AIStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Write the SSE response headers and flush them immediately, before any
 * event is written. Disables every layer of buffering between this process
 * and the browser so streamed chunks arrive as they are produced.
 *
 * @param res the raw response to write headers to.
 */
export function writeHead(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.flushHeaders();
}
