import type { AIStreamEvent } from "../shared/types";
import { accumulate, createInitialStreamState } from "./accumulate";

describe("accumulate", () => {
  it("appends delta text to result", () => {
    const state = accumulate(createInitialStreamState(), {
      type: "delta",
      text: "hello",
    });

    expect(state.result).toEqual("hello");
    expect(state.phase).toEqual("streaming");
  });

  it("leaves result byte-identical while a thought changes status", () => {
    const withResult = accumulate(createInitialStreamState(), {
      type: "delta",
      text: "hello world",
    });

    const withThought = accumulate(withResult, {
      type: "thought",
      text: "considering tone",
    });

    expect(withThought.result).toEqual(withResult.result);
    expect(withThought.status).toEqual("considering tone");
  });

  it("does not break delta ordering when a thought is interleaved", () => {
    const events: AIStreamEvent[] = [
      { type: "delta", text: "one " },
      { type: "thought", text: "thinking..." },
      { type: "delta", text: "two " },
      { type: "thought", text: "still thinking..." },
      { type: "delta", text: "three" },
    ];
    const deltaOnly: AIStreamEvent[] = events.filter((e) => e.type === "delta");

    const interleaved = events.reduce(accumulate, createInitialStreamState());
    const deltasOnly = deltaOnly.reduce(accumulate, createInitialStreamState());

    expect(interleaved.result).toEqual("one two three");
    expect(interleaved.result).toEqual(deltasOnly.result);
    expect(interleaved.status).toEqual("still thinking...");
  });

  it("sets failed and preserves the partial result on error", () => {
    const withResult = accumulate(createInitialStreamState(), {
      type: "delta",
      text: "partial output",
    });

    const failed = accumulate(withResult, {
      type: "error",
      message: "agent disconnected",
    });

    expect(failed.phase).toEqual("failed");
    expect(failed.message).toEqual("agent disconnected");
    expect(failed.result).toEqual("partial output");
  });

  it("clears status and sets complete on done", () => {
    const withStatus = accumulate(createInitialStreamState(), {
      type: "thought",
      text: "wrapping up",
    });

    const done = accumulate(withStatus, {
      type: "done",
      stopReason: "end_turn",
    });

    expect(done.phase).toEqual("complete");
    expect(done.status).toEqual("");
  });
});
