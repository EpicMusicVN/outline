import Router from "koa-router";
import {
  IntegrationService,
  IntegrationType,
  type IntegrationSettings,
} from "@shared/types";
import { InvalidRequestError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Integration, IntegrationAuthentication } from "@server/models";
import { authorize } from "@server/policies";
import { presentIntegration, presentPolicies } from "@server/presenters";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { validateUrlNotPrivate } from "@server/utils/url";
import {
  PlaneAuthError,
  PlaneClient,
  PlaneError,
} from "../PlaneClient";
import * as T from "./schema";
import { UnfurlResourceType } from "@shared/types";
import { toError } from "@shared/utils/error";
import Logger from "@server/logging/Logger";
import { PlaneNotFoundError } from "../PlaneClient";
import { PlaneUtils } from "../../shared/PlaneUtils";
import { PlaneInfoStatus } from "../../shared/types";
import { createHash } from "crypto";
import { Document } from "@server/models";
import Redis from "@server/storage/redis";

/** Hard cap on board items returned by `plane.info` (D5). */
const BoardItemLimit = 100;

/**
 * Guards `plane.createIssue` against double-submit: the same document,
 * project and title cannot create two issues within this short window
 * (R11). Released on failure so a genuine retry after a transient error
 * is not blocked for the full window.
 */
const CreateIssueIdempotencyTtlSeconds = 30;

function planeCreateIssueIdempotencyKey(
  teamId: string,
  documentId: string,
  projectId: string,
  title: string
): string {
  const digest = createHash("sha256").update(title).digest("hex");
  return `plane:createIssue:${teamId}:${documentId}:${projectId}:${digest}`;
}

const router = new Router();

router.post(
  "plane.connect",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.PlaneConnectSchema),
  transaction(),
  async (ctx: APIContext<T.PlaneConnectReq>) => {
    const { url: rawUrl, workspaceSlug, apiKey: rawApiKey } = ctx.input.body;
    const url = rawUrl.replace(/\/+$/, "");
    const apiKey = rawApiKey.trim();
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    authorize(user, "createIntegration", user.team);

    await validateUrlNotPrivate(url);

    const client = new PlaneClient({ baseUrl: url, apiKey });
    try {
      await client.listProjects(workspaceSlug);
    } catch (err) {
      if (err instanceof PlaneAuthError) {
        throw InvalidRequestError(
          "The Plane API key is invalid, expired, or not valid for this workspace"
        );
      }
      if (err instanceof PlaneError) {
        throw InvalidRequestError(
          `Unable to validate the Plane connection: ${err.message}`
        );
      }
      throw err;
    }

    let integration = await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: false,
        },
      ],
      transaction,
    });

    let authentication = integration?.authentication ?? null;
    if (authentication) {
      authentication.token = apiKey;
      await authentication.save({ transaction });
    } else {
      authentication = await IntegrationAuthentication.create(
        {
          service: IntegrationService.Plane,
          userId: user.id,
          teamId: user.teamId,
          token: apiKey,
        },
        { transaction }
      );
      if (integration) {
        integration.authenticationId = authentication.id;
        await integration.save({ transaction });
      }
    }

    const settings = {
      plane: { url, workspaceSlug },
      url,
    } as IntegrationSettings<IntegrationType.Embed>;

    if (!integration) {
      integration = await Integration.create(
        {
          service: IntegrationService.Plane,
          type: IntegrationType.Embed,
          userId: user.id,
          teamId: user.teamId,
          authenticationId: authentication.id,
          settings,
        } as Partial<Integration>,
        { transaction }
      );
    } else {
      integration.settings = settings;
      await integration.save({ transaction });
    }

    ctx.body = {
      data: presentIntegration(integration),
      policies: presentPolicies(user, [integration]),
    };
  }
);

router.post(
  "plane.disconnect",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.PlaneDisconnectSchema),
  transaction(),
  async (ctx: APIContext<T.PlaneDisconnectReq>) => {
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    authorize(user, "createIntegration", user.team);

    const integration = await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      transaction,
    });

    if (integration) {
      if (integration.authenticationId) {
        await IntegrationAuthentication.destroy({
          where: { id: integration.authenticationId },
          transaction,
        });
      }
      await integration.destroyWithCtx(ctx);
    }

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "plane.info",
  rateLimiter(RateLimiterStrategy.OneThousandPerHour),
  auth(),
  validate(T.PlaneInfoSchema),
  async (ctx: APIContext<T.PlaneInfoReq>) => {
    const { url } = ctx.input.body;
    const { user } = ctx.state.auth;

    const integration = (await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
    })) as Integration<IntegrationType.Embed> | null;

    const settings = integration?.settings?.plane;
    if (!integration?.authentication || !settings) {
      ctx.response.status = 204;
      return;
    }

    const resource = PlaneUtils.parseUrl(
      url,
      settings.url,
      settings.workspaceSlug
    );
    if (!resource) {
      ctx.response.status = 204;
      return;
    }

    const client = new PlaneClient({
      baseUrl: settings.url,
      apiKey: integration.authentication.token,
    });

    try {
      if (resource.type === UnfurlResourceType.Issue) {
        const workItem = await client.getWorkItem(
          resource.workspaceSlug,
          resource.projectId,
          resource.issueId
        );
        ctx.body = { data: PlaneClient.toPlaneCard(workItem, resource.url) };
        return;
      }

      const project = await client.getProject(
        resource.workspaceSlug,
        resource.projectId
      );
      const { items, hasMore } = await client.listProjectIssues(
        resource.workspaceSlug,
        resource.projectId,
        BoardItemLimit
      );
      ctx.body = {
        data: PlaneClient.toPlaneBoard(project, items, hasMore, {
          baseUrl: settings.url,
          workspaceSlug: resource.workspaceSlug,
          projectId: resource.projectId,
          url: resource.url,
        }),
      };
    } catch (err) {
      if (err instanceof PlaneAuthError) {
        ctx.body = { data: { type: PlaneInfoStatus.ReconnectRequired } };
        return;
      }
      if (err instanceof PlaneNotFoundError) {
        ctx.response.status = 204;
        return;
      }
      if (err instanceof PlaneError) {
        Logger.warn("Failed to fetch resource from Plane", toError(err));
        throw InvalidRequestError(
          `Unable to fetch data from Plane: ${err.message}`
        );
      }
      throw err;
    }
  }
);

router.post(
  "plane.projects",
  rateLimiter(RateLimiterStrategy.OneThousandPerHour),
  auth(),
  validate(T.PlaneProjectsSchema),
  async (ctx: APIContext<T.PlaneProjectsReq>) => {
    const { user } = ctx.state.auth;

    const integration = (await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
    })) as Integration<IntegrationType.Embed> | null;

    const settings = integration?.settings?.plane;
    if (!integration?.authentication || !settings) {
      ctx.response.status = 204;
      return;
    }

    const client = new PlaneClient({
      baseUrl: settings.url,
      apiKey: integration.authentication.token,
    });

    try {
      const projects = await client.listProjects(settings.workspaceSlug);
      ctx.body = {
        data: projects.map((project) =>
          PlaneClient.toPlaneProjectSummary(project)
        ),
      };
    } catch (err) {
      if (err instanceof PlaneAuthError) {
        ctx.body = { data: { type: PlaneInfoStatus.ReconnectRequired } };
        return;
      }
      if (err instanceof PlaneError) {
        Logger.warn("Failed to list Plane projects", toError(err));
        throw InvalidRequestError(
          `Unable to list Plane projects: ${err.message}`
        );
      }
      throw err;
    }
  }
);

router.post(
  "plane.createIssue",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.PlaneCreateIssueSchema),
  async (ctx: APIContext<T.PlaneCreateIssueReq>) => {
    const { documentId, projectId, title, description } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(documentId, {
      userId: user.id,
    });
    authorize(user, "update", document);

    const integration = (await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: user.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
    })) as Integration<IntegrationType.Embed> | null;

    const settings = integration?.settings?.plane;
    if (!integration?.authentication || !settings) {
      throw InvalidRequestError("Plane is not connected for this team");
    }

    const idempotencyKey = planeCreateIssueIdempotencyKey(
      user.teamId,
      documentId,
      projectId,
      title
    );
    const acquired = await Redis.defaultClient.set(
      idempotencyKey,
      "1",
      "EX",
      CreateIssueIdempotencyTtlSeconds,
      "NX"
    );
    if (!acquired) {
      throw InvalidRequestError(
        "A request to create this issue was already submitted; wait before retrying"
      );
    }

    const client = new PlaneClient({
      baseUrl: settings.url,
      apiKey: integration.authentication.token,
    });

    let issueUrl: string;
    let workItemId: string;
    try {
      const workItem = await client.createIssue(
        settings.workspaceSlug,
        projectId,
        { name: title, description_html: description }
      );
      issueUrl = PlaneClient.toIssueUrl(workItem, {
        baseUrl: settings.url,
        workspaceSlug: settings.workspaceSlug,
        projectId,
      });
      workItemId = workItem.id;
    } catch (err) {
      await Redis.defaultClient.del(idempotencyKey);
      if (err instanceof PlaneAuthError) {
        ctx.body = { data: { type: PlaneInfoStatus.ReconnectRequired } };
        return;
      }
      if (err instanceof PlaneError) {
        Logger.warn("Failed to create Plane issue", {
          error: toError(err).message,
          teamId: user.teamId,
          userId: user.id,
          projectId,
        });
        throw InvalidRequestError(
          `Unable to create Plane issue: ${err.message}`
        );
      }
      throw err;
    }

    Logger.info("plugins", "Created Plane issue", {
      teamId: user.teamId,
      userId: user.id,
      documentId,
      projectId,
      workItemId,
      url: issueUrl,
    });

    ctx.body = { data: { url: issueUrl } };
  }
);

export default router;
