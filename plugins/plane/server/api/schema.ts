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

export const PlaneInfoSchema = BaseSchema.extend({
  body: z.object({
    url: z.url(),
  }),
});

export type PlaneInfoReq = z.infer<typeof PlaneInfoSchema>;

export const PlaneProjectsSchema = BaseSchema.extend({
  body: z.object({}),
});

export type PlaneProjectsReq = z.infer<typeof PlaneProjectsSchema>;

export const PlaneCreateIssueSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.uuid(),
    projectId: z.uuid(),
    title: z.string().min(1).max(255),
    description: z.string().max(10000).optional(),
  }),
});

export type PlaneCreateIssueReq = z.infer<typeof PlaneCreateIssueSchema>;
