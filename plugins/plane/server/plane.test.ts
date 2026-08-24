import { http, HttpResponse } from "msw";
import { IntegrationService, IntegrationType } from "@shared/types";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import { Integration, IntegrationAuthentication } from "@server/models";
import { server as mswServer } from "@server/test/msw";
import { buildUser } from "@server/test/factories";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Plane } from "./plane";

const baseUrl = "https://8.8.8.8";
const apiKey = `plane_api_${"a".repeat(32)}`;
const workspaceSlug = "acme";
const projectId = "4a6c9c7b-d729-4200-85eb-100e65212acc";
const issueId = "9fa7264f-57b5-4cf9-812d-f57593d1ec02";
const issueUrl = `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${issueId}`;
const projectUrl = `${baseUrl}/${workspaceSlug}/projects/${projectId}`;

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
  assignees: [],
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

const expandedProject = {
  id: projectId,
  identifier: "SPK",
  name: "Spike project",
  description: "A test project",
  emoji: "🚀",
  icon_prop: { color: "#0ea5e9" },
  cover_image_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  archived_at: null,
};

async function createPlaneIntegration(user: User) {
  const authentication = await IntegrationAuthentication.create({
    service: IntegrationService.Plane,
    userId: user.id,
    teamId: user.teamId,
    token: apiKey,
  });

  const integration = await Integration.create({
    service: IntegrationService.Plane,
    type: IntegrationType.Embed,
    userId: user.id,
    teamId: user.teamId,
    authenticationId: authentication.id,
    settings: { plane: { url: baseUrl, workspaceSlug }, url: baseUrl },
  } as Partial<Integration>);

  return integration;
}

function mockPlane(pathPattern: string, status: number, body: unknown) {
  mswServer.use(
    http.get(`${baseUrl}/api/v1/${pathPattern}`, () =>
      HttpResponse.json(body, { status })
    )
  );
}

describe("#Plane.unfurl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return undefined when the team has no Plane integration", async () => {
    const user = await buildUser();

    const result = await Plane.unfurl(issueUrl, user);

    expect(result).toBeUndefined();
  });

  it("should return undefined for a foreign host", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);

    const result = await Plane.unfurl(
      `https://iframely.example.com/${workspaceSlug}/projects/${projectId}/issues/${issueId}`,
      user
    );

    expect(result).toBeUndefined();
  });

  it("should return undefined for an unrecognised path on the Plane host", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);

    const missingIssueId = await Plane.unfurl(
      `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues`,
      user
    );
    const unknownSegment = await Plane.unfurl(
      `${baseUrl}/${workspaceSlug}/settings`,
      user
    );

    expect(missingIssueId).toBeUndefined();
    expect(unknownSegment).toBeUndefined();
  });

  it("should return a full unfurl issue for a valid issue URL", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      200,
      expandedWorkItem
    );

    const result = await Plane.unfurl(issueUrl, user);

    expect(result).toEqual({
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

  it("should return a full unfurl project for a valid project URL", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}*`,
      200,
      expandedProject
    );

    const result = await Plane.unfurl(projectUrl, user);

    expect(result).toEqual({
      type: "project",
      url: projectUrl,
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
  });

  it("should return an error and log a warning on an upstream 500", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      500,
      {}
    );
    const warnSpy = vi.spyOn(Logger, "warn");

    const result = await Plane.unfurl(issueUrl, user);

    expect(result).toEqual({
      error: "Plane API request failed with status 500",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to fetch resource from Plane",
      expect.any(Error)
    );
  });

  it("should return an error instead of throwing on an upstream 401", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      401,
      { detail: "Authentication credentials were not provided." }
    );

    const result = await Plane.unfurl(issueUrl, user);

    expect(result).toEqual({
      error: "The Plane API key is invalid or expired",
    });
  });

  it("should return an error instead of throwing on an auth 403", async () => {
    const user = await buildUser();
    await createPlaneIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      403,
      { detail: "Given API token is not valid" }
    );

    const result = await Plane.unfurl(issueUrl, user);

    expect(result).toEqual({
      error: "The Plane API key is invalid or expired",
    });
  });
});
