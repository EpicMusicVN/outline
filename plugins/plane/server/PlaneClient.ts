import { IntegrationService, UnfurlResourceType } from "@shared/types";
import type { UnfurlIssueOrPR, UnfurlProject } from "@server/types";
import fetch, { type Response } from "@server/utils/fetch";
import { validateUrlNotPrivate } from "@server/utils/url";
import { z } from "zod";
import type {
  PlaneBoard,
  PlaneBoardColumn,
  PlaneBoardItem,
  PlaneIssueCard,
  PlaneProjectSummary,
} from "../shared/types";

const ApiVersion = "v1";
const WorkItemsSegment = "work-items";
const ExpandFields = "state,labels,assignees,created_by,project";
const InvalidTokenDetail = "Given API token is not valid";
const DefaultColor = "#6B7280";

const UserSchema = z
  .object({
    id: z.string(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    email: z.string().nullish(),
    display_name: z.string().nullish(),
    avatar_url: z.string().nullish(),
  })
  .passthrough();

const StateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullish(),
    group: z.string().nullish(),
  })
  .passthrough();

const LabelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullish(),
  })
  .passthrough();

const ProjectSchema = z
  .object({
    id: z.string(),
    identifier: z.string().nullish(),
    name: z.string(),
    description: z.string().nullish(),
    emoji: z.string().nullish(),
    icon_prop: z.unknown().nullish(),
    cover_image_url: z.string().nullish(),
    created_at: z.string().nullish(),
    archived_at: z.string().nullish(),
  })
  .passthrough();

const WorkItemSchema = z
  .object({
    id: z.string(),
    sequence_id: z.number().int().nullish(),
    name: z.string(),
    description_html: z.string().nullish(),
    priority: z.string().nullish(),
    state: z.union([z.string(), StateSchema]).nullish(),
    labels: z.array(z.union([z.string(), LabelSchema])).nullish(),
    assignees: z.array(z.union([z.string(), UserSchema])).nullish(),
    created_by: z.union([z.string(), UserSchema]).nullish(),
    created_at: z.string().nullish(),
    project: z.union([z.string(), ProjectSchema]).nullish(),
    project_id: z.string().nullish(),
    workspace: z.string().nullish(),
  })
  .passthrough();

const ProjectListSchema = z
  .object({
    results: z.array(ProjectSchema),
  })
  .passthrough();

const ProjectSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    identifier: z.string().nullish(),
    counts: z
      .object({
        states: z.number().nullish(),
        issues: z.number().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const PlaneErrorBodySchema = z
  .object({
    detail: z.string().optional(),
  })
  .passthrough();

export type WorkItem = z.infer<typeof WorkItemSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export class PlaneError extends Error {}

export class PlaneAuthError extends PlaneError {}

export class PlaneConfigError extends PlaneError {}

export class PlaneRateLimitError extends PlaneError {}

export class PlaneNotFoundError extends PlaneError {}

const WorkItemListSchema = z
  .object({
    results: z.array(WorkItemSchema),
  })
  .passthrough();

export class PlaneClient {
  private baseUrl: string;
  private apiKey: string;

  constructor({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  public async listProjects(workspaceSlug: string): Promise<Project[]> {
    const data = await this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/projects/`,
      ProjectListSchema
    );
    return data.results;
  }

  public async getWorkItem(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<WorkItem> {
    return this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/projects/${encodeURIComponent(projectId)}/${WorkItemsSegment}/${encodeURIComponent(
        issueId
      )}/?expand=${ExpandFields}`,
      WorkItemSchema
    );
  }

  public async getWorkItemByIdentifier(
    workspaceSlug: string,
    identifier: string
  ): Promise<WorkItem> {
    return this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/${WorkItemsSegment}/${encodeURIComponent(identifier)}/?expand=${ExpandFields}`,
      WorkItemSchema
    );
  }

  public async getProject(
    workspaceSlug: string,
    projectId: string
  ): Promise<Project> {
    return this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/projects/${encodeURIComponent(projectId)}/?expand=${ExpandFields}`,
      ProjectSchema
    );
  }

  public async getProjectSummary(
    workspaceSlug: string,
    projectId: string
  ): Promise<ProjectSummary> {
    return this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/projects/${encodeURIComponent(projectId)}/summary/`,
      ProjectSummarySchema
    );
  }

  public static stripHtml(html: string | null | undefined): string | null {
    if (!html) {
      return null;
    }
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  public static toUnfurlIssue(
    workItem: WorkItem,
    url: string
  ): UnfurlIssueOrPR {
    const state =
      workItem.state !== null && typeof workItem.state === "object"
        ? workItem.state
        : null;
    const project =
      workItem.project !== null && typeof workItem.project === "object"
        ? workItem.project
        : null;
    const createdBy =
      workItem.created_by !== null && typeof workItem.created_by === "object"
        ? workItem.created_by
        : null;
    const issueId =
      project?.identifier && typeof workItem.sequence_id === "number"
        ? `${project.identifier}-${workItem.sequence_id}`
        : workItem.id;

    return {
      type: UnfurlResourceType.Issue,
      service: IntegrationService.Plane,
      url,
      id: issueId,
      title: workItem.name,
      description: PlaneClient.stripHtml(workItem.description_html),
      author: createdBy
        ? {
            name:
              createdBy.display_name ||
              [createdBy.first_name, createdBy.last_name]
                .filter(Boolean)
                .join(" ") ||
              createdBy.email ||
              "Unknown",
            avatarUrl: createdBy.avatar_url ?? "",
          }
        : { name: "Unknown", avatarUrl: "" },
      labels: (workItem.labels ?? []).map((label) =>
        typeof label === "string"
          ? { name: label, color: DefaultColor }
          : { name: label.name, color: label.color ?? DefaultColor }
      ),
      state: {
        type: state?.group ?? undefined,
        name: state?.name ?? "Unknown",
        color: state?.color ?? DefaultColor,
      },
      createdAt: workItem.created_at ?? "",
    } satisfies UnfurlIssueOrPR;
  }

  public static toUnfurlProject(project: Project, url: string): UnfurlProject {
    const color =
      project.icon_prop &&
      typeof project.icon_prop === "object" &&
      "color" in project.icon_prop &&
      typeof project.icon_prop.color === "string"
        ? project.icon_prop.color
        : DefaultColor;

    return {
      type: UnfurlResourceType.Project,
      url,
      id: project.id,
      name: project.name,
      color,
      description: project.description ?? null,
      lead: null,
      state: {
        name: "Project",
        color,
        type: "project",
      },
      labels: [],
      createdAt: project.created_at ?? "",
      targetDate: null,
    } satisfies UnfurlProject;
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    await validateUrlNotPrivate(url);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
        },
      });
    } catch {
      throw new PlaneError(`Failed to connect to Plane at ${this.baseUrl}`);
    }

    if (res.status === 401) {
      throw new PlaneAuthError("The Plane API key is invalid or expired");
    }
    if (res.status === 403) {
      const body = await this.parseErrorBody(res);
      if (body?.detail === InvalidTokenDetail) {
        throw new PlaneAuthError("The Plane API key is invalid or expired");
      }
      throw new PlaneConfigError(
        "The Plane API key does not have permission to access this resource"
      );
    }
    if (res.status === 429) {
      throw new PlaneRateLimitError("Plane API rate limit exceeded");
    }
    if (res.status === 404) {
      throw new PlaneNotFoundError(
        "The requested Plane resource does not exist"
      );
    }
    if (!res.ok) {
      throw new PlaneError(`Plane API request failed with status ${res.status}`);
    }

    const json = await res.json().catch(() => {
      throw new PlaneError("Plane API returned an invalid response");
    });
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new PlaneError(
        "Plane API returned an unexpected response shape"
      );
    }
    return parsed.data;
  }

  private async parseErrorBody(
    res: Response
  ): Promise<{ detail?: string } | null> {
    try {
      const json = await res.json();
      const parsed = PlaneErrorBodySchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  public async listProjectIssues(
    workspaceSlug: string,
    projectId: string,
    limit: number
  ): Promise<{ items: WorkItem[]; hasMore: boolean }> {
    const data = await this.request(
      `/api/${ApiVersion}/workspaces/${encodeURIComponent(
        workspaceSlug
      )}/projects/${encodeURIComponent(projectId)}/${WorkItemsSegment}/?expand=${ExpandFields}&per_page=${
        limit + 1
      }`,
      WorkItemListSchema
    );
    return {
      items: data.results.slice(0, limit),
      hasMore: data.results.length > limit,
    };
  }

  public static toPlaneCard(workItem: WorkItem, url: string): PlaneIssueCard {
    const state =
      workItem.state !== null && typeof workItem.state === "object"
        ? workItem.state
        : null;
    const project =
      workItem.project !== null && typeof workItem.project === "object"
        ? workItem.project
        : null;
    const createdBy =
      workItem.created_by !== null && typeof workItem.created_by === "object"
        ? workItem.created_by
        : null;
    const issueId =
      project?.identifier && typeof workItem.sequence_id === "number"
        ? `${project.identifier}-${workItem.sequence_id}`
        : workItem.id;

    return {
      type: UnfurlResourceType.Issue,
      url,
      id: issueId,
      title: workItem.name,
      description: PlaneClient.stripHtml(workItem.description_html),
      author: createdBy
        ? {
            name:
              createdBy.display_name ||
              [createdBy.first_name, createdBy.last_name]
                .filter(Boolean)
                .join(" ") ||
              createdBy.email ||
              "Unknown",
            avatarUrl: createdBy.avatar_url ?? "",
          }
        : { name: "Unknown", avatarUrl: "" },
      assignees: PlaneClient.mapAssignees(workItem.assignees),
      labels: PlaneClient.mapLabels(workItem.labels),
      state: {
        id: state?.id ?? "unknown",
        name: state?.name ?? "Unknown",
        color: state?.color ?? DefaultColor,
        group: state?.group ?? undefined,
      },
      createdAt: workItem.created_at ?? "",
    } satisfies PlaneIssueCard;
  }

  public static toPlaneBoard(
    project: Project,
    items: WorkItem[],
    hasMore: boolean,
    context: {
      baseUrl: string;
      workspaceSlug: string;
      projectId: string;
      url: string;
    }
  ): PlaneBoard {
    const columns = new Map<string, PlaneBoardColumn>();

    for (const workItem of items) {
      const state =
        workItem.state !== null && typeof workItem.state === "object"
          ? workItem.state
          : null;
      const key = state?.id ?? "unknown";

      let column = columns.get(key);
      if (!column) {
        column = {
          state: {
            id: key,
            name: state?.name ?? "Unknown",
            color: state?.color ?? DefaultColor,
            group: state?.group ?? undefined,
          },
          items: [],
        };
        columns.set(key, column);
      }

      const itemProject =
        workItem.project !== null && typeof workItem.project === "object"
          ? workItem.project
          : null;
      const issueId =
        itemProject?.identifier && typeof workItem.sequence_id === "number"
          ? `${itemProject.identifier}-${workItem.sequence_id}`
          : workItem.id;

      column.items.push({
        id: issueId,
        url: `${context.baseUrl}/${context.workspaceSlug}/projects/${context.projectId}/issues/${workItem.id}/`,
        title: workItem.name,
        priority: workItem.priority ?? null,
        labels: PlaneClient.mapLabels(workItem.labels),
        assignees: PlaneClient.mapAssignees(workItem.assignees),
      } satisfies PlaneBoardItem);
    }

    return {
      type: UnfurlResourceType.Project,
      url: context.url,
      id: project.id,
      name: project.name,
      columns: Array.from(columns.values()),
      hasMore,
    } satisfies PlaneBoard;
  }

  public static toPlaneProjectSummary(project: Project): PlaneProjectSummary {
    return {
      id: project.id,
      name: project.name,
      identifier: project.identifier ?? null,
    } satisfies PlaneProjectSummary;
  }

  private static mapLabels(
    labels: WorkItem["labels"]
  ): PlaneIssueCard["labels"] {
    return (labels ?? []).map((label) =>
      typeof label === "string"
        ? { name: label, color: DefaultColor }
        : { name: label.name, color: label.color ?? DefaultColor }
    );
  }

  private static mapAssignees(
    assignees: WorkItem["assignees"]
  ): PlaneIssueCard["assignees"] {
    const result: PlaneIssueCard["assignees"] = [];
    for (const assignee of assignees ?? []) {
      if (typeof assignee !== "object" || assignee === null) {
        continue;
      }
      result.push({
        name:
          assignee.display_name ||
          [assignee.first_name, assignee.last_name]
            .filter(Boolean)
            .join(" ") ||
          assignee.email ||
          "Unknown",
        avatarUrl: assignee.avatar_url ?? "",
      });
    }
    return result;
  }
}
