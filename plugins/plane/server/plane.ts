import {
  IntegrationService,
  IntegrationType,
  UnfurlResourceType,
} from "@shared/types";
import { errToString, toError } from "@shared/utils/error";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import { Integration, IntegrationAuthentication } from "@server/models";
import type { UnfurlSignature } from "@server/types";
import { PlaneUtils } from "../shared/PlaneUtils";
import { PlaneClient } from "./PlaneClient";

export class Plane {
  /**
   * Unfurls a Plane issue or project URL for a team. Returns undefined for
   * URLs that do not belong to the team's configured Plane instance so that
   * later providers (iframely) can handle them, and only returns an error
   * when a Plane URL genuinely failed to fetch.
   */
  public static unfurl: UnfurlSignature = async (url: string, actor: User) => {
    const integration = (await Integration.findOne({
      where: { service: IntegrationService.Plane, teamId: actor.teamId },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
    })) as Integration<IntegrationType.Embed> | null;

    if (!integration?.authentication) {
      Logger.debug(
        "plugins",
        `No Plane integration found for team ${actor.teamId}`
      );
      return;
    }

    const settings = integration.settings?.plane;
    if (!settings) {
      return;
    }

    const resource = PlaneUtils.parseUrl(
      url,
      settings.url,
      settings.workspaceSlug
    );
    if (!resource) {
      return;
    }

    try {
      const client = new PlaneClient({
        baseUrl: settings.url,
        apiKey: integration.authentication.token,
      });

      if (resource.type === UnfurlResourceType.Issue) {
        const workItem = await client.getWorkItem(
          resource.workspaceSlug,
          resource.projectId,
          resource.issueId
        );
        return PlaneClient.toUnfurlIssue(workItem, resource.url);
      }

      const project = await client.getProject(
        resource.workspaceSlug,
        resource.projectId
      );
      return PlaneClient.toUnfurlProject(project, resource.url);
    } catch (err) {
      Logger.warn("Failed to fetch resource from Plane", toError(err));
      return {
        error: errToString(err) || "Unknown error",
      };
    }
  };
}
