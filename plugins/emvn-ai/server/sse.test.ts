import type { ServerResponse } from "node:http";
import type { AIStreamEvent } from "../shared/types";
import { encodeEvent, HEARTBEAT, writeHead } from "./sse";

function fakeResponse() {
  const writeHeadSpy = vi.fn();
  const flushHeadersSpy = vi.fn();
  const res = {
    writeHead: writeHeadSpy,
    flushHeaders: flushHeadersSpy,
  } as unknown as ServerResponse;
  return { res, writeHeadSpy, flushHeadersSpy };
}

describe("encodeEvent", () => {
  it("encodes a delta event as a data frame", () => {
    const event: AIStreamEvent = { type: "delta", text: "hello" };
    expect(encodeEvent(event)).toEqual(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("encodes a thought event as a data frame", () => {
    const event: AIStreamEvent = { type: "thought", text: "thinking..." };
    expect(encodeEvent(event)).toEqual(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("encodes a done event as a data frame", () => {
    const event: AIStreamEvent = { type: "done", stopReason: "end_turn" };
    expect(encodeEvent(event)).toEqual(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("encodes an error event as a data frame", () => {
    const event: AIStreamEvent = { type: "error", message: "boom" };
    expect(encodeEvent(event)).toEqual(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("survives embedded newlines through a JSON round-trip", () => {
    const event: AIStreamEvent = {
      type: "delta",
      text: "line one\nline two\r\nline three",
    };
    const frame = encodeEvent(event);

    // Exactly one framing blank line — none introduced by the payload itself.
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.slice("data: ".length, -2).includes("\n\n")).toBe(false);

    const payload = frame.slice("data: ".length, -2);
    expect(JSON.parse(payload)).toEqual(event);
  });
});

describe("HEARTBEAT", () => {
  it("is a comment line, never a data frame", () => {
    expect(HEARTBEAT).toEqual(": ping\n\n");
    expect(HEARTBEAT.startsWith(":")).toBe(true);
    expect(HEARTBEAT.startsWith("data:")).toBe(false);
  });
});

describe("writeHead", () => {
  it("sets the SSE headers required to defeat buffering, then flushes them", () => {
    const { res, writeHeadSpy, flushHeadersSpy } = fakeResponse();

    writeHead(res);

    expect(writeHeadSpy).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    expect(flushHeadersSpy).toHaveBeenCalledTimes(1);

    // Headers must be written before they are flushed.
    expect(writeHeadSpy.mock.invocationCallOrder[0]).toBeLessThan(
      flushHeadersSpy.mock.invocationCallOrder[0]
    );
  });
});
