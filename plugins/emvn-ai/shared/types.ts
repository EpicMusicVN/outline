import type { AICommandId } from "./commands";

export type AIStreamEvent =
  | { type: "delta"; text: string }
  | { type: "thought"; text: string }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string };

export type AICommandRequest = {
  commandId: AICommandId;
  text: string;
  documentId: string;
  targetId: string;
  language?: string;
};

export type PublicAITarget = {
  id: string;
  label: string;
};
