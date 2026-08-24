import {
  listPublicTargets,
  parseTargetRegistry,
  resolveTarget,
} from "./targets";
import type { AITarget } from "./targets";

const validTargets: AITarget[] = [
  {
    id: "writer",
    label: "Writing assistant",
    instanceId: "inst-1",
    token: "tok-1",
  },
  { id: "editor", label: "Editor", instanceId: "inst-2" },
];

// Registry is parsed from the environment at import time, so tests reload the
// module with stubbed env (module-loading boundary, see
// server/utils/environment.test.ts).
const loadRegistry = async (targets: string, mintToken?: string) => {
  vi.resetModules();
  process.env.EMVN_AI_TARGETS = targets;
  if (mintToken === undefined) {
    delete process.env.EMVN_AI_MINT_TOKEN;
  } else {
    process.env.EMVN_AI_MINT_TOKEN = mintToken;
  }
  return await import("./targets");
};

afterEach(() => {
  delete process.env.EMVN_AI_TARGETS;
  delete process.env.EMVN_AI_MINT_TOKEN;
});

describe("emvn-ai target registry", () => {
  describe("parseTargetRegistry", () => {
    it("should parse a valid JSON array into typed targets", () => {
      const parsed = parseTargetRegistry(
        JSON.stringify(validTargets),
        "default-token"
      );
      expect(parsed).toEqual(validTargets);
    });

    it("should allow an entry without a token when a default mint token exists", () => {
      const parsed = parseTargetRegistry(
        JSON.stringify([
          { id: "writer", label: "Writer", instanceId: "inst-1" },
        ]),
        "default-token"
      );
      expect(parsed).toEqual([
        { id: "writer", label: "Writer", instanceId: "inst-1" },
      ]);
    });

    it("should return an empty registry when the value is unset", () => {
      expect(parseTargetRegistry(undefined)).toEqual([]);
    });

    it("should return an empty registry when the value is blank", () => {
      expect(parseTargetRegistry("  ")).toEqual([]);
    });

    it("should throw on malformed JSON", () => {
      expect(() =>
        parseTargetRegistry("{ nope", "default-token")
      ).toThrow("EMVN_AI_TARGETS must be a valid JSON array");
    });

    it("should throw on a non-array value", () => {
      expect(() =>
        parseTargetRegistry('{"id":"writer"}', "default-token")
      ).toThrow("EMVN_AI_TARGETS must be a JSON array");
    });

    it("should throw on an empty array", () => {
      expect(() => parseTargetRegistry("[]", "default-token")).toThrow(
        "EMVN_AI_TARGETS must contain at least one target"
      );
    });

    it("should throw on duplicate ids", () => {
      const duplicated = JSON.stringify([
        { id: "writer", label: "A", instanceId: "inst-1" },
        { id: "writer", label: "B", instanceId: "inst-2" },
      ]);
      expect(() => parseTargetRegistry(duplicated, "default-token")).toThrow(
        "target ids must be unique"
      );
    });

    it("should throw when an entry is missing a required field", () => {
      const missingInstanceId = JSON.stringify([
        { id: "writer", label: "Writer" },
      ]);
      expect(() =>
        parseTargetRegistry(missingInstanceId, "default-token")
      ).toThrow("EMVN_AI_TARGETS must be a JSON array");
    });

    it("should throw when an entry has no token and no default mint token exists", () => {
      const tokenless = JSON.stringify([
        { id: "writer", label: "Writer", instanceId: "inst-1" },
      ]);
      expect(() => parseTargetRegistry(tokenless)).toThrow(
        'EMVN_AI_TARGETS target "writer" requires a token or EMVN_AI_MINT_TOKEN'
      );
    });
  });

  describe("module registry", () => {
    it("should resolve a configured target by id", async () => {
      const registry = await loadRegistry(
        JSON.stringify(validTargets),
        "default-token"
      );
      const resolution = registry.resolveTarget("writer");
      expect(resolution).toEqual({
        found: true,
        target: {
          id: "writer",
          label: "Writing assistant",
          instanceId: "inst-1",
          token: "tok-1",
        },
      });
      expect(resolveTarget("writer")).toEqual({ found: false });
    });

    it("should return a typed miss for an unknown id", async () => {
      const registry = await loadRegistry(
        JSON.stringify(validTargets),
        "default-token"
      );
      expect(registry.resolveTarget("nope")).toEqual({ found: false });
    });

    it("should expose only id and label publicly", async () => {
      const registry = await loadRegistry(
        JSON.stringify(validTargets),
        "default-token"
      );
      const publicTargets = registry.listPublicTargets();
      expect(publicTargets).toEqual([
        { id: "writer", label: "Writing assistant" },
        { id: "editor", label: "Editor" },
      ]);
      for (const target of publicTargets) {
        expect(Object.keys(target)).toEqual(["id", "label"]);
      }
    // The top-level (non-reloaded) import reflects the real .env.test
    // EMVN_AI_TARGETS config, proving loadRegistry's dynamic import is an
    // isolated module instance rather than sharing cached state with it.
    expect(listPublicTargets()).toEqual([
      { id: "test-target", label: "Test Target" },
    ]);
    });
  });
});
