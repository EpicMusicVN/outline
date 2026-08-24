import environment from "@server/utils/environment";
import { z } from "zod";
import type { PublicAITarget } from "../shared/types";

export type AITarget = {
  id: string;
  label: string;
  instanceId: string;
  token?: string;
};

export type TargetResolution =
  | { found: true; target: AITarget }
  | { found: false };

const TargetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  instanceId: z.string().min(1),
  token: z.string().min(1).optional(),
});

const TargetRegistrySchema = z.array(TargetSchema);

/**
 * Parse the raw EMVN_AI_TARGETS env value into validated target entries.
 *
 * @param raw raw JSON array from the environment, or undefined when unset.
 * @param mintToken the default mint credential used when an entry has no token.
 * @returns validated target entries; an empty list when raw is unset or blank.
 * @throws when raw is present but is not a non-empty JSON array of valid
 * entries, or an
 * entry has no token and no default mint token exists.
 */
export function parseTargetRegistry(
  raw: string | undefined,
  mintToken?: string
): AITarget[] {
  if (!raw?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("EMVN_AI_TARGETS must be a valid JSON array");
  }

  const result = TargetRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      "EMVN_AI_TARGETS must be a JSON array of { id, label, instanceId, token? } entries"
    );
  }

  const targets = result.data;
  if (targets.length === 0) {
    throw new Error("EMVN_AI_TARGETS must contain at least one target");
  }

  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) {
      throw new Error(
        `EMVN_AI_TARGETS target ids must be unique (duplicate "${target.id}")`
      );
    }
    seen.add(target.id);
  }

  const targetWithoutToken = targets.find(
    (target) => !target.token && !mintToken
  );
  if (targetWithoutToken) {
    throw new Error(
      `EMVN_AI_TARGETS target "${targetWithoutToken.id}" requires a token or EMVN_AI_MINT_TOKEN`
    );
  }

  return targets;
}

const rawTargets = environment.EMVN_AI_TARGETS;
const defaultMintToken = environment.EMVN_AI_MINT_TOKEN;

const registry: ReadonlyMap<string, AITarget> = new Map(
  parseTargetRegistry(rawTargets, defaultMintToken).map(
    (target): [string, AITarget] => [target.id, target]
  )
);

/**
 * Resolve a target by id from the registry.
 *
 * @param id the target id to resolve.
 * @returns the found target, or a typed miss when the id is unknown.
 */
export function resolveTarget(id: string): TargetResolution {
  const target = registry.get(id);
  return target ? { found: true, target } : { found: false };
}

/**
 * Build the public projection of configured targets for the browser.
 *
 * @returns entries containing only the id and label keys.
 */
export function listPublicTargets(): PublicAITarget[] {
  return Array.from(registry.values(), ({ id, label }) => ({ id, label }));
}
