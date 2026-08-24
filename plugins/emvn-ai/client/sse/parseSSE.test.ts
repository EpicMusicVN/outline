import type { AIStreamEvent } from "../../shared/types";
import { createSSEParser } from "./parseSSE";

function frame(event: AIStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("createSSEParser", () => {
  it("parses a single complete frame", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "delta", text: "hello" };

    expect(parse(frame(event))).toEqual([event]);
  });

  it("parses two frames delivered in one chunk", () => {
    const parse = createSSEParser();
    const first: AIStreamEvent = { type: "delta", text: "a" };
    const second: AIStreamEvent = { type: "delta", text: "b" };

    expect(parse(frame(first) + frame(second))).toEqual([first, second]);
  });

  it("reassembles a frame split mid data: line", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "delta", text: "hello world" };
    const whole = frame(event);
    const splitAt = whole.indexOf("hello");

    expect(parse(whole.slice(0, splitAt))).toEqual([]);
    expect(parse(whole.slice(splitAt))).toEqual([event]);
  });

  it("reassembles a frame split mid JSON payload", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "thought", text: "considering" };
    const whole = frame(event);
    const splitAt = Math.floor(whole.length / 2);

    expect(parse(whole.slice(0, splitAt))).toEqual([]);
    expect(parse(whole.slice(splitAt))).toEqual([event]);
  });

  it("reassembles a frame split between the two terminating newlines", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "done", stopReason: "end_turn" };
    const whole = frame(event);
    const splitAt = whole.length - 1;

    expect(parse(whole.slice(0, splitAt))).toEqual([]);
    expect(parse(whole.slice(splitAt))).toEqual([event]);
  });

  it("ignores heartbeat comment lines", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "delta", text: "after ping" };

    expect(parse(`: ping\n\n${frame(event)}`)).toEqual([event]);
  });

  it("joins multi-line data: continuations with \\n before parsing", () => {
    const parse = createSSEParser();
    const event: AIStreamEvent = { type: "delta", text: "hello" };
    const payload = JSON.stringify(event);
    const splitPoint = Math.floor(payload.length / 2);
    const multiLine = `data: ${payload.slice(0, splitPoint)}\ndata: ${payload.slice(splitPoint)}\n\n`;

    expect(parse(multiLine)).toEqual([event]);
  });

  it("drops an unknown event type without throwing", () => {
    const parse = createSSEParser();
    const known: AIStreamEvent = { type: "delta", text: "kept" };
    const unknown = `data: ${JSON.stringify({ type: "session_started", id: "s1" })}\n\n`;

    expect(() => parse(unknown + frame(known))).not.toThrow();
    expect(parse(unknown + frame(known))).toEqual([known]);
  });

  it("drops malformed JSON without throwing and stays usable for later frames", () => {
    const parse = createSSEParser();
    const malformed = "data: {not json\n\n";
    const known: AIStreamEvent = { type: "delta", text: "still works" };

    expect(() => parse(malformed)).not.toThrow();
    expect(parse(malformed)).toEqual([]);
    expect(parse(frame(known))).toEqual([known]);
  });
});
