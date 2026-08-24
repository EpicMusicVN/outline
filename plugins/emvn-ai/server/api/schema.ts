import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { AICommandId } from "../../shared/commands";
import env from "../env";

export const CommandSchema = BaseSchema.extend({
  body: z
    .object({
      /** Which editor command to run; a closed set, never a free-form prompt. */
      commandId: z.nativeEnum(AICommandId),
      /** The selection (or preceding text) the command runs against. */
      text: z.string().min(1).max(8000),
      /** The document the selection was taken from, for authorization. */
      documentId: z.uuid(),
      /** Which configured agent target to run the command against. */
      targetId: z.string().min(1),
      /** Required, and validated against the configured list, for translate. */
      language: z.string().max(32).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.commandId !== AICommandId.Translate) {
        return;
      }

      const language = value.language?.trim();
      if (!language) {
        ctx.addIssue({
          code: "custom",
          path: ["language"],
          message: "language is required for the translate command",
        });
        return;
      }

      const allowed = env.EMVN_AI_TRANSLATE_LANGUAGES.split(",").map((code) =>
        code.trim()
      );
      if (!allowed.includes(language)) {
        ctx.addIssue({
          code: "custom",
          path: ["language"],
          message: "language is not supported",
        });
      }
    }),
});

export type CommandReq = z.infer<typeof CommandSchema>;
