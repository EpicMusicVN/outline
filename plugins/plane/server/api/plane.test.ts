import { http, HttpResponse } from "msw";
import type { JsonBodyType } from "msw";
import { IntegrationService, IntegrationType } from "@shared/types";
import { Integration, IntegrationAuthentication } from "@server/models";
import { server     as mswServer } from "@server/test/msw";
import { buildAdmin, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "@server/models";
import RateLimiter from "@server/utils/RateLimiter";
import env from "@server/env";
import { buildDocument, buildTeam, buildViewer } from "@server/test/factories";
import { PlaneUtils } from "../../shared/PlaneUtils";

const server = getTestServer();
const url = "https://8.8.8.8";
const workspaceSlug = "acme";
const apiKey = `plane_api_${"a".repeat(32)}`;

function connectBody(overrides: Record<string, string> = {}) {
  return {
    url,
    workspaceSlug,
    apiKey,
    ...overrides,
  };
}

async function findPlaneIntegration(teamId: string) {
  return Integration.findOne({
    where: { service: IntegrationService.Plane, teamId },
    include: [
      {
        model: IntegrationAuthentication,
        as: "authentication",
        required: true,
      },
    ],
  });
}

describe("#plane.connect", () => {
  beforeEach(() => {
    mswServer.use(
      http.get(`${url}/api/v1/workspaces/${workspaceSlug}/projects*`, () =>
        HttpResponse.json({ results: [] }, { status: 200 })
      )
    );
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/plane.connect", {
      body: connectBody(),
    });
    expect(res.status).toEqual(401);
  });

  it("should require an admin", async () => {
    const user = await buildUser();
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody(),
    });
    expect(res.status).toEqual(403);
  });

  it("should reject private URLs", async () => {
    const user = await buildAdmin();
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody({ url: "https://127.0.0.1" }),
    });
    expect(res.status).toEqual(400);
  });

  it("should reject URLs without a scheme", async () => {
    const user = await buildAdmin();
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody({ url: "plane.example.com" }),
    });
    expect(res.status).toEqual(400);
  });

  it("should reject URLs that are not https", async () => {
    const user = await buildAdmin();
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody({ url: "http://8.8.8.8" }),
    });
    expect(res.status).toEqual(400);
  });

  it("should connect, storing the key encrypted and never returning it", async () => {
    const user = await buildAdmin();
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody({ url: "https://8.8.8.8/" }),
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    expect(body.data.settings.plane).toEqual({
      url,
      workspaceSlug,
    });
    expect(body.data.settings.url).toEqual(url);
    expect(JSON.stringify(body)).not.toContain(apiKey);

    const integration = await findPlaneIntegration(user.teamId);
    expect(integration).not.toBeNull();
    expect(integration!.settings).toEqual({
      plane: { url, workspaceSlug },
      url,
    });
    expect(integration!.authentication.token).toEqual(apiKey);
    // OAuth-only columns are left unset (D1): the Encrypted getter reads
    // unset BLOB columns as "" (allowNull is falsy) and plain STRING as null.
    expect(integration!.authentication.refreshToken).toBe("");
    expect(integration!.authentication.clientId).toBeNull();
    expect(integration!.authentication.clientSecret).toBe("");
  });

  it("should not leak the API key through integrations.list", async () => {
    const user = await buildAdmin();
    await server.post("/api/plane.connect", user, {
      body: connectBody(),
    });

    const res = await server.post("/api/integrations.list", user, {
      body: { service: IntegrationService.Plane, type: IntegrationType.Embed },
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].settings.plane).toEqual({ url, workspaceSlug });
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it("should update the existing connection rather than create a duplicate", async () => {
    const user = await buildAdmin();
    await server.post("/api/plane.connect", user, {
      body: connectBody(),
    });

    const rotatedKey = `plane_api_${"b".repeat(32)}`;
    const res = await server.post("/api/plane.connect", user, {
      body: connectBody({ apiKey: rotatedKey }),
    });
    expect(res.status).toEqual(200);

    const integrations = await Integration.findAll({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
    });
    expect(integrations).toHaveLength(1);
    expect(integrations[0].authentication.token).toEqual(rotatedKey);
  });
});

describe("#plane.disconnect", () => {
  it("should require an admin", async () => {
    const user = await buildUser();
    const res = await server.post("/api/plane.disconnect", user, {
      body: {},
    });
    expect(res.status).toEqual(403);
  });

  it("should remove the integration and its authentication row", async () => {
    const user = await buildAdmin();
    mswServer.use(
      http.get(`${url}/api/v1/workspaces/${workspaceSlug}/projects*`, () =>
        HttpResponse.json({ results: [] }, { status: 200 })
      )
    );
    await server.post("/api/plane.connect", user, {
      body: connectBody(),
    });

    const integration = await findPlaneIntegration(user.teamId);
    const authenticationId = integration!.authenticationId;

    const res = await server.post("/api/plane.disconnect", user, {
      body: {},
    });
    expect(res.status).toEqual(200);
    expect((await res.json()).success).toBe(true);

    const remaining = await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
    });
    expect(remaining).toBeNull();
    const authentication = await IntegrationAuthentication.findByPk(
      authenticationId
    );
    expect(authentication).toBeNull();
  });
});

const projectId = "4a6c9c7b-d729-4200-85eb-100e65212acc";
const issueId = "9fa7264f-57b5-4cf9-812d-f57593d1ec02";
const issueUrl = `${url}/${workspaceSlug}/projects/${projectId}/issues/${issueId}`;
const projectUrl = `${url}/${workspaceSlug}/projects/${projectId}`;

function buildWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    id: issueId,
    sequence_id: 1,
    name: "Spike issue one",
    description_html: "<p>Hello <strong>world</strong></p>",
    priority: "high",
    state: {
      id: "st-1",
      name: "Backlog",
      color: "#808080",
      group: "backlog",
    },
    labels: [{ id: "lb-1", name: "bug", color: "#ff0000" }],
    assignees: [
      {
        id: "u-1",
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        display_name: "Jane Doe",
        avatar_url: "",
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
    ...overrides,
  };
}

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

async function createConnectedIntegration(user: User) {
  const authentication = await IntegrationAuthentication.create({
    service: IntegrationService.Plane,
    userId: user.id,
    teamId: user.teamId,
    token: apiKey,
  });

  return Integration.create({
    service: IntegrationService.Plane,
    type: IntegrationType.Embed,
    userId: user.id,
    teamId: user.teamId,
    authenticationId: authentication.id,
    settings: { plane: { url, workspaceSlug }, url },
  } as Partial<Integration>);
}

function mockPlane(pathPattern: string, status: number, body: JsonBodyType) {
  mswServer.use(
    http.get(`${url}/api/v1/${pathPattern}`, () =>
      HttpResponse.json(body, { status })
    )
  );
}

describe("#plane.info", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/plane.info", {
      body: { url: issueUrl },
    });
    expect(res.status).toEqual(401);
  });

  it("should return 204 when the team has no Plane integration", async () => {
    const user = await buildUser();
    const res = await server.post("/api/plane.info", user, {
      body: { url: issueUrl },
    });
    expect(res.status).toEqual(204);
  });

  it("should return a card payload for a valid issue URL without leaking Plane-internal fields", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      200,
      buildWorkItem()
    );

    const res = await server.post("/api/plane.info", user, {
      body: { url: issueUrl },
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    expect(body.data).toEqual({
      type: "issue",
      url: issueUrl,
      id: "SPK-1",
      title: "Spike issue one",
      description: "Hello world",
      author: { name: "John Smith", avatarUrl: "" },
      assignees: [{ name: "Jane Doe", avatarUrl: "" }],
      labels: [{ name: "bug", color: "#ff0000" }],
      state: {
        id: "st-1",
        name: "Backlog",
        color: "#808080",
        group: "backlog",
      },
      createdAt: "2026-08-24T10:00:00.000Z",
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(apiKey);
    expect(raw).not.toContain("description_html");
    expect(raw).not.toContain("sequence_id");
  });

  it("should return a capped, state-grouped board for a valid project URL", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}*`,
      200,
      expandedProject
    );
    const items = Array.from({ length: 101 }, (_, i) =>
      buildWorkItem({
        id: `item-${i}`,
        sequence_id: i + 1,
        name: `Issue ${i}`,
        state:
          i % 2 === 0
            ? { id: "st-1", name: "Backlog", color: "#808080", group: "backlog" }
            : { id: "st-2", name: "Done", color: "#22c55e", group: "completed" },
      })
    );
    mswServer.use(
      http.get(
        `${url}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/*`,
        () => HttpResponse.json({ results: items }, { status: 200 })
      )
    );

    const res = await server.post("/api/plane.info", user, {
      body: { url: projectUrl },
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    expect(body.data.type).toEqual("project");
    expect(body.data.url).toEqual(projectUrl);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.columns).toHaveLength(2);
    const totalItems = body.data.columns.reduce(
      (sum: number, column: { items: unknown[] }) => sum + column.items.length,
      0
    );
    expect(totalItems).toEqual(100);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(apiKey);
    expect(raw).not.toContain("description_html");
    expect(raw).not.toContain("icon_prop");
  });

  it("should reject a URL from a different Plane host than the team's configured one", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);

    const res = await server.post("/api/plane.info", user, {
      body: {
        url: `https://evil.example.com/${workspaceSlug}/projects/${projectId}/issues/${issueId}`,
      },
    });
    expect(res.status).toEqual(204);
  });

  it("should signal reconnect required when Plane returns 401", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);
    mockPlane(
      `workspaces/${workspaceSlug}/projects/${projectId}/work-items/${issueId}*`,
      401,
      { detail: "Authentication credentials were not provided." }
    );

    const res = await server.post("/api/plane.info", user, {
      body: { url: issueUrl },
    });
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data).toEqual({ type: "reconnect_required" });
  });

  it("should register a rate limiter for this route", async () => {
    const originalEnabled = env.RATE_LIMITER_ENABLED;
    env.RATE_LIMITER_ENABLED = true;
    try {
      const user = await buildUser();
      await server.post("/api/plane.info", user, {
        body: { url: issueUrl },
      });
      expect(RateLimiter.hasRateLimiter("/api/plane.info")).toBe(true);
      expect(RateLimiter.getRateLimiter("/api/plane.info").points).toEqual(
        1000
      );
    } finally {
      env.RATE_LIMITER_ENABLED = originalEnabled;
    }
  });
});

describe("#plane.projects", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/plane.projects", { body: {} });
    expect(res.status).toEqual(401);
  });

  it("should return 204 when the team has no Plane integration", async () => {
    const user = await buildUser();
    const res = await server.post("/api/plane.projects", user, {
      body: {},
    });
    expect(res.status).toEqual(204);
  });

  it("should return the team's Plane projects", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);
    mockPlane(`workspaces/${workspaceSlug}/projects*`, 200, {
      results: [expandedProject],
    });

    const res = await server.post("/api/plane.projects", user, {
      body: {},
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    expect(body.data).toEqual([
      { id: projectId, name: "Spike project", identifier: "SPK" },
    ]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(apiKey);
    expect(raw).not.toContain("icon_prop");
  });

  it("should signal reconnect required when Plane returns 401", async () => {
    const user = await buildUser();
    await createConnectedIntegration(user);
    mockPlane(`workspaces/${workspaceSlug}/projects*`, 401, {
      detail: "Authentication credentials were not provided.",
    });

    const res = await server.post("/api/plane.projects", user, {
      body: {},
    });
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data).toEqual({ type: "reconnect_required" });
  });

  it("should register a rate limiter for this route", async () => {
    const originalEnabled = env.RATE_LIMITER_ENABLED;
    env.RATE_LIMITER_ENABLED = true;
    try {
      const user = await buildUser();
      await server.post("/api/plane.projects", user, { body: {} });
      expect(RateLimiter.hasRateLimiter("/api/plane.projects")).toBe(true);
      expect(
        RateLimiter.getRateLimiter("/api/plane.projects").points
      ).toEqual(1000);
    } finally {
      env.RATE_LIMITER_ENABLED = originalEnabled;
    }
  });
});

describe("#plane.createIssue", () => {
  function createIssueBody(overrides: Record<string, string> = {}) {
    return {
      documentId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      projectId,
      title: "New issue title",
      ...overrides,
    };
  }

  const createPath = `${url}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/`;

  it("should require authentication", async () => {
    const res = await server.post("/api/plane.createIssue", {
      body: createIssueBody(),
    });
    expect(res.status).toEqual(401);
  });

  it("should reject a user without document write permission", async () => {
    const team = await buildTeam();
    const author = await buildUser({ teamId: team.id });
    const viewer = await buildViewer({ teamId: team.id });
    const document = await buildDocument({
      userId: author.id,
      teamId: team.id,
    });
    await createConnectedIntegration(author);

    const res = await server.post("/api/plane.createIssue", viewer, {
      body: createIssueBody({ documentId: document.id }),
    });
    expect(res.status).toEqual(403);
  });

  it("should return a typed error, not a 500, when the team has no Plane integration", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/plane.createIssue", user, {
      body: createIssueBody({ documentId: document.id }),
    });
    expect(res.status).toEqual(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("should reject with a 4xx, not a 500, for an unknown project and release the idempotency guard", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    await createConnectedIntegration(user);
    mswServer.use(
      http.post(createPath, () =>
        HttpResponse.json(
          { detail: "You do not have permission to perform this action." },
          { status: 403 }
        )
      )
    );

    const body = createIssueBody({
      documentId: document.id,
      title: "Unknown project issue",
    });
    const failed = await server.post("/api/plane.createIssue", user, {
      body,
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(failed.status).toBeLessThan(500);

    // No partial state: the failed attempt must not leave a stale
    // idempotency lock blocking a legitimate retry with the same inputs.
    mswServer.use(
      http.post(createPath, () =>
        HttpResponse.json(
          buildWorkItem({ id: issueId, name: "Unknown project issue" }),
          { status: 201 }
        )
      )
    );
    const retried = await server.post("/api/plane.createIssue", user, {
      body,
    });
    expect(retried.status).toEqual(200);
  });

  it("should signal reconnect required when Plane returns 401", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    await createConnectedIntegration(user);
    mswServer.use(
      http.post(createPath, () =>
        HttpResponse.json(
          { detail: "Authentication credentials were not provided." },
          { status: 401 }
        )
      )
    );

    const res = await server.post("/api/plane.createIssue", user, {
      body: createIssueBody({ documentId: document.id }),
    });
    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data).toEqual({ type: "reconnect_required" });
  });

  it("should create only one issue when the same request is double-submitted", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    await createConnectedIntegration(user);

    let callCount = 0;
    mswServer.use(
      http.post(createPath, async () => {
        callCount += 1;
        return HttpResponse.json(buildWorkItem({ name: "Race issue" }), {
          status: 201,
        });
      })
    );

    const body = createIssueBody({
      documentId: document.id,
      title: "Race issue",
    });
    const [first, second] = await Promise.all([
      server.post("/api/plane.createIssue", user, { body }),
      server.post("/api/plane.createIssue", user, { body }),
    ]);

    const statuses = [first.status, second.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);
    expect(callCount).toEqual(1);
  });

  it("should register a rate limiter for this route", async () => {
    const originalEnabled = env.RATE_LIMITER_ENABLED;
    env.RATE_LIMITER_ENABLED = true;
    try {
      const user = await buildUser();
      const document = await buildDocument({
        userId: user.id,
        teamId: user.teamId,
      });
      await server.post("/api/plane.createIssue", user, {
        body: createIssueBody({ documentId: document.id }),
      });
      expect(RateLimiter.hasRateLimiter("/api/plane.createIssue")).toBe(true);
      expect(
        RateLimiter.getRateLimiter("/api/plane.createIssue").points
      ).toEqual(25);
    } finally {
      env.RATE_LIMITER_ENABLED = originalEnabled;
    }
  });

  it("should create an issue and return a URL that PlaneUtils.parseUrl accepts", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    await createConnectedIntegration(user);

    const createdId = "b6f9f6d0-1c9a-4d2a-9b0e-2a6c2a4d9f11";
    mswServer.use(
      http.post(createPath, () =>
        HttpResponse.json(
          buildWorkItem({ id: createdId, name: "New issue" }),
          { status: 201 }
        )
      )
    );

    const res = await server.post("/api/plane.createIssue", user, {
      body: createIssueBody({
        documentId: document.id,
        title: "New issue",
      }),
    });
    expect(res.status).toEqual(200);

    const body = await res.json();
    const expectedUrl = `${url}/${workspaceSlug}/projects/${projectId}/issues/${createdId}/`;
    expect(body.data.url).toEqual(expectedUrl);
    expect(PlaneUtils.parseUrl(body.data.url, url, workspaceSlug)).toEqual({
      type: "issue",
      workspaceSlug,
      projectId,
      issueId: createdId,
      url: expectedUrl,
    });
  });
});
