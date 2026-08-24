import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const PlaneConnectSchema = BaseSchema.extend({
  body: z.object({
    url: z.url().startsWith("https://"),
    workspaceSlug: z.string().min(1).max(255),
    apiKey: z.string().min(1).max(512),
  }),
});

export type PlaneConnectReq = z.infer<typeof PlaneConnectSchema>;

export const PlaneDisconnectSchema = BaseSchema.extend({
  body: z.object({}),
});

export type PlaneDisconnectReq = z.infer<typeof PlaneDisconnectSchema>;
