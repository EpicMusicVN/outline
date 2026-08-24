import type { AIStreamEvent } from "../../shared/types";
import type { AITarget } from "../targets";
import { AcpBackend } from "./AcpBackend";

export type AIRequest = {
  prompt: string;
  target: AITarget;
  requestId: string;
};

export interface AIBackend {
  stream(
    request: AIRequest,
    options: { signal: AbortSignal }
  ): AsyncIterable<AIStreamEvent>;
}

export function getAIBackend(): AIBackend {
  return new AcpBackend();
}
