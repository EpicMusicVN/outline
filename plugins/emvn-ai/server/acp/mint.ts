import Logger from "@server/logging/Logger";
import { z } from "zod";
import env from "../env";
import type { AITarget } from "../targets";

export const MINT_PATH = "/api/agent-acp/instances/:instanceId/session";
export const MINT_METHOD = "POST" as const;
export const MINT_RESPONSE_FIELDS = ["token", "wsUrl", "agentId", "expiresIn"] as const;
export const MINT_TIMEOUT_MS = 10_000;

const MintResponseSchema = z.object({
  token: z.string().min(1),
  wsUrl: z.string().min(1),
  agentId: z.string().min(1),
  expiresIn: z.number(),
});

export type MintChatToken = { token: string; wsUrl: string };

export class MintError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MintError";
  }
}

export async function mintChatToken(
  target: AITarget,
  signal: AbortSignal
): Promise<MintChatToken> {
  const apiUrl = env.EMVN_AI_API_URL;
  const credential = target.token ?? env.EMVN_AI_MINT_TOKEN;
  if (!apiUrl || !credential) {
    throw new MintError("Mint request failed");
  }

  const url = new URL(
    MINT_PATH.replace(":instanceId", target.instanceId),
    apiUrl
  );
  const controller = new AbortController();
  const abortOnSignal = (): void => {
    controller.abort();
  };
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", abortOnSignal);
  }
  const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: MINT_METHOD,
      headers: { Authorization: `Bearer ${credential}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      Logger.info("plugins", `Mint request failed with HTTP status ${response.status}`, {
        targetId: target.id,
      });
      throw new MintError("Mint request failed");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MintError("Mint response was invalid");
    }

    const parsed = MintResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new MintError("Mint response was invalid");
    }

    const { token, wsUrl, agentId } = parsed.data;
    if (agentId !== target.instanceId) {
      Logger.info("plugins", "Mint response agent id did not match the requested instance", {
        targetId: target.id,
      });
      throw new MintError("Mint response was invalid");
    }

    return { token, wsUrl };
  } catch (error) {
    if (error instanceof MintError) {
      throw error;
    }
    Logger.info("plugins", "Mint request failed", { targetId: target.id });
    throw new MintError("Mint request failed");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortOnSignal);
  }
}
