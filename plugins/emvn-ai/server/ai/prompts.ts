import { AICommandId } from "../../shared/commands";

export type PromptInput = {
  text: string;
  language?: string;
};

export type PromptTemplate = (input: PromptInput) => string;

const delimit = (text: string): string => `<text>\n${text}\n</text>`;

const summarize: PromptTemplate = ({ text }) =>
  `Summarize the following text. Return only the summary as markdown, with no preamble or extra commentary.\n\n${delimit(text)}`;

const continueWriting: PromptTemplate = ({ text }) =>
  `Continue writing from the following text, matching its style and tone. Return only the continuation as markdown, with no preamble or extra commentary.\n\n${delimit(text)}`;

const rewrite: PromptTemplate = ({ text }) =>
  `Rewrite the following text for clarity and quality while preserving its meaning. Return only the rewritten text as markdown, with no preamble or extra commentary.\n\n${delimit(text)}`;

const translate: PromptTemplate = ({ text, language }) => {
  const target = language?.trim() || "English";
  return `Translate the following text into ${target}. Return only the translation as markdown, with no preamble or extra commentary.\n\n${delimit(text)}`;
};

export const PROMPTS: Readonly<Record<AICommandId, PromptTemplate>> =
  Object.freeze({
    [AICommandId.Summarize]: summarize,
    [AICommandId.ContinueWriting]: continueWriting,
    [AICommandId.Rewrite]: rewrite,
    [AICommandId.Translate]: translate,
  });

export function buildPrompt(commandId: AICommandId, input: PromptInput): string {
  const template = PROMPTS[commandId];
  if (!template) {
    throw new Error(`No prompt template for command "${String(commandId)}"`);
  }
  return template(input);
}
