import {
  MINT_METHOD,
  MINT_PATH,
  MINT_RESPONSE_FIELDS,
  MintError,
  mintChatToken,
} from "./mint";
import env from "../env";
import type { AITarget } from "../targets";

const baseTarget: AITarget = {
  id: "writer",
  label: "Writer",
  instanceId: "inst-1",
};

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

const fetchMock = vi.fn();

// The plugin env singleton is eagerly loaded by server/test/setup.ts's
// import.meta.glob before this file's own imports resolve, so vi.mock("../env")
// cannot intercept the already-cached instance in a full-suite run (same
// class of issue as the emvnAi route's getAIBackend spy). Mutate the real
// shared singleton instead, matching the plugin's plain (non-frozen) fields.
const originalApiUrl = env.EMVN_AI_API_URL;
const originalMintToken = env.EMVN_AI_MINT_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  env.EMVN_AI_API_URL = "https://hub.example.com";
  env.EMVN_AI_MINT_TOKEN = "default-mint-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  env.EMVN_AI_API_URL = originalApiUrl;
  env.EMVN_AI_MINT_TOKEN = originalMintToken;
});

describe("mintChatToken", () => {
  it("should pin the mint path, method, and response fields as constants", () => {
    expect(MINT_PATH).toBe("/api/agent-acp/instances/:instanceId/session");
    expect(MINT_METHOD).toBe("POST");
    expect(MINT_RESPONSE_FIELDS).toEqual(["token", "wsUrl", "agentId", "expiresIn"]);
  });

  it("should POST the pinned path with no body and the default bearer token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        token: "minted-token",
        wsUrl: "wss://hub.example.com/ws/chat",
        agentId: "inst-1",
        expiresIn: 300,
      })
    );

    const result = await mintChatToken(baseTarget, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://hub.example.com/api/agent-acp/instances/inst-1/session"
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({
      Authorization: "Bearer default-mint-token",
    });
    expect(result).toEqual({
      token: "minted-token",
      wsUrl: "wss://hub.example.com/ws/chat",
    });
  });

  it("should use the per-target token over the env default", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        token: "t",
        wsUrl: "wss://x/chat",
        agentId: "inst-1",
        expiresIn: 300,
      })
    );

    await mintChatToken(
      { ...baseTarget, token: "per-instance-token" },
      new AbortController().signal
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      Authorization: "Bearer per-instance-token",
    });
  });

  it("should reject when the response agent id does not match the instance", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        token: "t",
        wsUrl: "wss://x/chat",
        agentId: "other-inst",
        expiresIn: 300,
      })
    );

    const promise = mintChatToken(baseTarget, new AbortController().signal);
    await expect(promise).rejects.toBeInstanceOf(MintError);
    await expect(promise).rejects.toThrow("Mint response was invalid");
  });

  it("should reject with a generic MintError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, false, 503));

    const promise = mintChatToken(baseTarget, new AbortController().signal);
    await expect(promise).rejects.toBeInstanceOf(MintError);
    await expect(promise).rejects.toThrow("Mint request failed");
  });

  it("should reject when the response is missing the token field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        wsUrl: "wss://x/chat",
        agentId: "inst-1",
        expiresIn: 300,
      })
    );

    const promise = mintChatToken(baseTarget, new AbortController().signal);
    await expect(promise).rejects.toBeInstanceOf(MintError);
    await expect(promise).rejects.toThrow("Mint response was invalid");
  });

  it("should reject when the response body is not parseable JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    const promise = mintChatToken(baseTarget, new AbortController().signal);
    await expect(promise).rejects.toBeInstanceOf(MintError);
    await expect(promise).rejects.toThrow("Mint response was invalid");
  });

  it("should never include the credential, endpoint, or instance in thrown messages", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ token: "t", wsUrl: "wss://x", agentId: "inst-1", expiresIn: 300 }, false, 401)
    );

    const error = await mintChatToken(
      baseTarget,
      new AbortController().signal
    ).catch((error: unknown) => error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("default-mint-token");
    expect(message).not.toContain("hub.example.com");
    expect(message).not.toContain("inst-1");
  });
});
