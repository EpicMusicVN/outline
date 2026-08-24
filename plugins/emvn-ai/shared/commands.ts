export enum AICommandId {
  Summarize = "summarize",
  ContinueWriting = "continueWriting",
  Rewrite = "rewrite",
  Translate = "translate",
}

export type AICommandResultMode = "replace" | "insert";

export type AICommandMetadata = {
  resultMode: AICommandResultMode;
  requiresSelection: boolean;
  hasLanguageParam: boolean;
};

export const AICommandMetadataMap = Object.freeze({
  [AICommandId.Summarize]: {
    resultMode: "replace",
    requiresSelection: true,
    hasLanguageParam: false,
  },
  [AICommandId.ContinueWriting]: {
    resultMode: "insert",
    requiresSelection: false,
    hasLanguageParam: false,
  },
  [AICommandId.Rewrite]: {
    resultMode: "replace",
    requiresSelection: true,
    hasLanguageParam: false,
  },
  [AICommandId.Translate]: {
    resultMode: "replace",
    requiresSelection: true,
    hasLanguageParam: true,
  },
} satisfies Record<AICommandId, AICommandMetadata>);
