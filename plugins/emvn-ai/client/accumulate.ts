import type { AIStreamEvent } from "../shared/types";

export type StreamPhase = "streaming" | "complete" | "failed";

export type StreamState = {
  result: string;
  status: string;
  phase: StreamPhase;
  message?: string;
};

export function createInitialStreamState(): StreamState {
  return { result: "", status: "", phase: "streaming" };
}

/**
 * Folds one `AIStreamEvent` into the running stream state. This is the one
 * place that decides what reaches `result` — reasoning (`thought`) can only
 * ever change `status`, never `result`, which is what keeps "the agent's
 * reasoning never lands in the document" a unit-testable property instead of
 * an invariant scattered across the streaming hook.
 */
export function accumulate(state: StreamState, event: AIStreamEvent): StreamState {
  switch (event.type) {
    case "delta":
      return { ...state, result: state.result + event.text };
    case "thought":
      return { ...state, status: event.text };
    case "done":
      return { ...state, phase: "complete", status: "" };
    case "error":
      return { ...state, phase: "failed", message: event.message };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
