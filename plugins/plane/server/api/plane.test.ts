import { http, HttpResponse } from "msw";
import { IntegrationService, IntegrationType } from "@shared/types";
import { Integration, IntegrationAuthentication } from "@server/models";
import { server     as mswServer } from "@server/test/msw";
import { buildAdmin, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { beforeEach, describe, expect, it } from "vitest";

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
