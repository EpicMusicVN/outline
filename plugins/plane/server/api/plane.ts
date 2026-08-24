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

export default router;
