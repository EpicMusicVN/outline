import type { AIStreamEvent } from "../../shared/types";

const DATA_PREFIX = "data:";

/**
 * Validates the `type` discriminator and the fields that variant requires.
 * Anything else — an unknown `type`, or a known `type` missing its payload
 * field — is treated as forward-incompatible and dropped, never thrown.
 */
function isAIStreamEvent(value: unknown): value is AIStreamEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "delta":
    case "thought":
      return typeof record.text === "string";
    case "done":
      return typeof record.stopReason === "string";
    case "error":
      return typeof record.message === "string";
    default:
      return false;
  }
}

/**
 * Parses one complete SSE frame (everything between two `\n\n` boundaries,
 * exclusive) into an event. Lines starting with `:` are comments —
 * heartbeats in this protocol — and are ignored. Multiple `data:` lines are
 * joined with `\n` before parsing, per the SSE spec.
 */
function parseFrame(frame: string): AIStreamEvent | undefined {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":") || !line.startsWith(DATA_PREFIX)) {
      continue;
    }
    const rest = line.slice(DATA_PREFIX.length);
    dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
  }
  if (dataLines.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return undefined;
  }

  return isAIStreamEvent(parsed) ? parsed : undefined;
}

/**
 * Creates an incremental SSE frame parser over a series of raw text chunks
 * (as delivered by `TextDecoder({ stream: true })`). The closure buffers any
 * trailing partial frame between calls, so a frame split across chunk
 * boundaries — mid `data:` line, mid JSON, or between the two newlines that
 * terminate a frame — is parsed correctly once it completes.
 */
export function createSSEParser(): (chunk: string) => AIStreamEvent[] {
  let buffer = "";

  return (chunk: string): AIStreamEvent[] => {
    buffer += chunk;
    const events: AIStreamEvent[] = [];

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = parseFrame(buffer.slice(0, boundary));
      if (event) {
        events.push(event);
      }
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }

    return events;
  };
}
