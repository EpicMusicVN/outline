import { http, HttpResponse } from "msw";
import type { JsonBodyType } from "msw";
import { IntegrationService, UnfurlResourceType } from "@shared/types";
import { server } from "@server/test/msw";
import { describe, expect, it } from "vitest";
import {
  PlaneAuthError,
  PlaneClient,
  PlaneConfigError,
  PlaneError,
  PlaneNotFoundError,
  PlaneRateLimitError,
} from "./PlaneClient";

const baseUrl = "https://8.8.8.8";
const apiKey = `plane_api_${"a".repeat(32)}`;
const workspaceSlug = "spike-ws";
const projectId = "4a6c9c7b-d729-4200-85eb-100e65212acc";
const issueId = "9fa7264f-57b5-4cf9-812d-f57593d1ec02";
const expandQuery = "state,labels,assignees,created_by,project";
const issueUrl = `https://plane.example.com/${workspaceSlug}/projects/${projectId}/issues/${issueId}`;

const expandedWorkItem = {
  id: issueId,
  sequence_id: 1,
  name: "Spike issue one",
  description_html: "<p>Hello <strong>world</strong></p>",
  priority: "high",
  state: { id: "st-1", name: "Backlog", color: "#808080", group: "backlog" },
  labels: [
    { id: "lb-1", name: "bug", color: "#ff0000" },
    { id: "lb-2", name: "feature", color: "#00ff00" },
  ],
  assignees: [
    {
      id: "u-1",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      display_name: "Jane Doe",
      avatar_url: "https://example.com/jane.png",
    },
  ],
  created_by: {
    id: "u-2",
    first_name: "John",
    last_name: "Smith",
    email: "john@example.com",
    display_name: "John Smith",
    avatar_url: "",
  },
  created_at: "2026-08-24T10:00:00.000Z",
  project: {
    id: projectId,
    identifier: "SPK",
    name: "Spike",
    description: "A test project",
    emoji: "🚀",
    icon_prop: { color: "#0ea5e9" },
    cover_image_url: null,
    archived_at: null,
  },
  project_id: projectId,
  workspace: "ws-1",
};

function mockPlane(
  pathPattern: string,
  status: number,
  body: JsonBodyType,
  onRequest?: (request: Request) => void
) {
  server.use(
    http.get(`${baseUrl}/api/v1/${pathPattern}`, ({ request }) => {
      onRequest?.(request);
      return HttpResponse.json(body, { status });
    })
  );
}

describe("#PlaneClient", () => {
  describe("#getWorkItem", () => {
    it("should map an expanded work item to an unfurl issue", async () => {
      let capturedUrl = "";
      mockPlane(
        `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
        200,
        expandedWorkItem,
        (request) => {
          capturedUrl = request.url;
          expect(request.headers.get("X-Api-Key")).toBe(apiKey);
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const item = await client.getWorkItem(
        workspaceSlug,
        projectId,
        issueId
      );

      expect(capturedUrl).toContain(`?expand=${expandQuery}`);
      expect(capturedUrl).toContain("/work-items/");

      const unfurl = PlaneClient.toUnfurlIssue(item, issueUrl);
      expect(unfurl).toEqual({
        type: "issue",
        service: IntegrationService.Plane,
        url: issueUrl,
        id: "SPK-1",
        title: "Spike issue one",
        description: "Hello world",
        author: { name: "John Smith", avatarUrl: "" },
        labels: [
          { name: "bug", color: "#ff0000" },
          { name: "feature", color: "#00ff00" },
        ],
        state: { type: "backlog", name: "Backlog", color: "#808080" },
        createdAt: "2026-08-24T10:00:00.000Z",
      });
    });

    it("should tolerate null description and empty labels and assignees", async () => {
      mockPlane(
        `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
        200,
        {
          ...expandedWorkItem,
          description_html: null,
          labels: [],
          assignees: [],
          created_by: null,
          state: null,
          sequence_id: null,
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const item = await client.getWorkItem(
        workspaceSlug,
        projectId,
        issueId
      );
      const unfurl = PlaneClient.toUnfurlIssue(item, issueUrl);
      if (unfurl.type !== UnfurlResourceType.Issue) {
        throw new Error("expected an issue unfurl");
      }

      expect(unfurl.description).toBeNull();
      expect(unfurl.labels).toEqual([]);
      expect(unfurl.author).toEqual({ name: "Unknown", avatarUrl: "" });
      expect(unfurl.state).toEqual({
        type: undefined,
        name: "Unknown",
        color: "#6B7280",
      });
      expect(unfurl.id).toBe(issueId);
    });
  });

  describe("#getWorkItemByIdentifier", () => {
    it("should read the project UUID from the project field when project_id is null", async () => {
      let capturedUrl = "";
      mockPlane(
        `workspaces/${workspaceSlug}/work-items/SPK-1*`,
        200,
        {
          ...expandedWorkItem,
          project_id: null,
          project: projectId,
        },
        (request) => {
          capturedUrl = request.url;
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const item = await client.getWorkItemByIdentifier(
        workspaceSlug,
        "SPK-1"
      );
      const projectUuid =
        typeof item.project === "object" && item.project !== null
          ? item.project.id
          : item.project;

      expect(capturedUrl).toContain(
        `/api/v1/workspaces/${workspaceSlug}/work-items/SPK-1/`
      );
      expect(projectUuid).toBe(projectId);
    });
  });

  describe("#listProjects", () => {
    it("should parse the results out of the cursor envelope", async () => {
      mockPlane(
        `workspaces/${workspaceSlug}/projects*`,
        200,
        {
          count: 1,
          total_count: 1,
          total_results: 1,
          next_cursor: "abc",
          results: [
            {
              id: projectId,
              identifier: "SPK",
              name: "Spike",
              description: "A test project",
            },
          ],
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const projects = await client.listProjects(workspaceSlug);

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("Spike");
    });
  });

  describe("#getProject", () => {
    it("should map a project to an unfurl project", async () => {
      mockPlane(
        `workspaces/${workspaceSlug}/projects/${projectId}*`,
        200,
        {
          id: projectId,
          identifier: "SPK",
          name: "Spike project",
          description: "A test project",
          emoji: "🚀",
          icon_prop: { color: "#0ea5e9" },
          cover_image_url: null,
          created_at: "2026-08-01T00:00:00.000Z",
          archived_at: null,
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const project = await client.getProject(workspaceSlug, projectId);
      const unfurl = PlaneClient.toUnfurlProject(
        project,
        `https://plane.example.com/${workspaceSlug}/projects/${projectId}`
      );

      expect(unfurl).toEqual({
        type: "project",
        url: `https://plane.example.com/${workspaceSlug}/projects/${projectId}`,
        id: projectId,
        name: "Spike project",
        color: "#0ea5e9",
        description: "A test project",
        lead: null,
        state: { name: "Project", color: "#0ea5e9", type: "project" },
        labels: [],
        createdAt: "2026-08-01T00:00:00.000Z",
        targetDate: null,
      });
      expect(unfurl.progress).toBeUndefined();
    });
  });

  describe("#getProjectSummary", () => {
    it("should parse the summary counts", async () => {
      mockPlane(
        `workspaces/${workspaceSlug}/projects/${projectId}/summary*`,
        200,
        {
          id: projectId,
          name: "Spike",
          identifier: "SPK",
          counts: { states: 4, issues: 12 },
        }
      );
      const client = new PlaneClient({ baseUrl, apiKey });

      const summary = await client.getProjectSummary(workspaceSlug, projectId);

      expect(summary.counts.issues).toBe(12);
    });
  });

  describe("error taxonomy", () => {
    const client = new PlaneClient({ baseUrl, apiKey });
    const projectsPath = `workspaces/${workspaceSlug}/projects*`;

    it("should raise PlaneAuthError on 401", async () => {
      mockPlane(projectsPath, 401, {
        detail: "Authentication credentials were not provided.",
      });
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneAuthError
      );
    });

    it("should raise PlaneAuthError on 403 with the invalid token detail", async () => {
      mockPlane(projectsPath, 403, { detail: "Given API token is not valid" });
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneAuthError
      );
    });

    it("should not treat a permission 403 as an auth error", async () => {
      mockPlane(projectsPath, 403, {
        detail: "You do not have permission to perform this action.",
      });
      const err = await client.listProjects(workspaceSlug).catch((e) => e);
      expect(err).toBeInstanceOf(PlaneConfigError);
      expect(err).not.toBeInstanceOf(PlaneAuthError);
    });

    it("should raise PlaneNotFoundError on 404", async () => {
      mockPlane(projectsPath, 404, {
        error: "The requested resource does not exist.",
      });
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneNotFoundError
      );
    });

    it("should raise PlaneRateLimitError on 429", async () => {
      mockPlane(projectsPath, 429, { detail: "Request was throttled." });
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneRateLimitError
      );
    });

    it("should raise PlaneError on malformed JSON", async () => {
      server.use(
        http.get(`${baseUrl}/api/v1/${projectsPath}`, () =>
          HttpResponse.text("not json", { status: 200 })
        )
      );
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneError
      );
    });

    it("should raise PlaneError on a network failure", async () => {
      server.use(
        http.get(`${baseUrl}/api/v1/${projectsPath}`, () =>
          HttpResponse.error()
        )
      );
      await expect(client.listProjects(workspaceSlug)).rejects.toBeInstanceOf(
        PlaneError
      );
    });
  });

  describe("#stripHtml", () => {
    it("should strip tags and decode basic entities", () => {
      expect(PlaneClient.stripHtml("<p>Hello <strong>world</strong></p>")).toBe(
        "Hello world"
      );
      expect(PlaneClient.stripHtml("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
    });

    it("should return null for nullish or empty input", () => {
      expect(PlaneClient.stripHtml(null)).toBeNull();
      expect(PlaneClient.stripHtml(undefined)).toBeNull();
      expect(PlaneClient.stripHtml("")).toBeNull();
    });
  });
});
