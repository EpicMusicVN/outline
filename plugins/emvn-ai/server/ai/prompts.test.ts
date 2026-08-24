import { AICommandId } from "../../shared/commands";
import { PROMPTS, buildPrompt } from "./prompts";
import type { PromptInput } from "./prompts";

const input: PromptInput = {
  text: "The quick brown fox jumps over the lazy dog.",
};

describe("emvn-ai prompt registry", () => {
  it("should be frozen", () => {
    expect(Object.isFrozen(PROMPTS)).toBe(true);
  });

  it("should produce deterministic output for each command", () => {
    for (const commandId of Object.values(AICommandId)) {
      expect(buildPrompt(commandId, input)).toBe(
        buildPrompt(commandId, input)
      );
    }
  });

  it("should delimit the user text in every template", () => {
    for (const commandId of Object.values(AICommandId)) {
      expect(buildPrompt(commandId, input)).toContain(input.text);
    }
  });

  it("should produce distinct prompts per command", () => {
    const outputs = Object.values(AICommandId).map((commandId) =>
      buildPrompt(commandId, input)
    );
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it("should interpolate the target language for translate", () => {
    const prompt = buildPrompt(AICommandId.Translate, {
      text: "hello",
      language: "French",
    });
    expect(prompt).toContain("French");
    expect(prompt).toContain("hello");
  });

  it("should default the translate language when omitted", () => {
    expect(
      buildPrompt(AICommandId.Translate, { text: "hello" })
    ).toContain("English");
  });

  it("should throw for an unknown command id", () => {
    expect(() => buildPrompt("unknown" as AICommandId, input)).toThrow(
      "No prompt template"
    );
  });
});
