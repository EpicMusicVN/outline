import { UnfurlResourceType } from "@shared/types";

/**
 * Web path segments of a Plane issue and project URL. Named as constants at
 * the top of the file so a verification gate can correct them in one place if
 * the deployed Plane CE version changes them.
 */
const ProjectsSegment = "projects";
const IssuesSegment = "issues";

export class PlaneUtils {
  /**
   * Parses a Plane URL and extracts resource identifiers.
   *
   * @param url - The Plane URL to parse.
   * @param baseUrl - The configured base URL of the team's Plane instance.
   * @param workspaceSlug - Optional expected workspace slug from settings.
   * @returns An object containing resource identifiers or undefined if the
   * URL is invalid, belongs to another host, or is not a recognised resource.
   */
  public static parseUrl(
    url: string,
    baseUrl: string,
    workspaceSlug?: string
  ):
    | {
        type: UnfurlResourceType.Issue;
        workspaceSlug: string;
        projectId: string;
        issueId: string;
        url: string;
      }
    | {
        type: UnfurlResourceType.Project;
        workspaceSlug: string;
        projectId: string;
        url: string;
      }
    | undefined {
    let parsed: URL;
    let parsedBase: URL;

    try {
      parsed = new URL(url);
      parsedBase = new URL(baseUrl);
    } catch {
      return;
    }

    // Reject URLs for other hosts before any path parsing.
    if (parsed.hostname !== parsedBase.hostname) {
      return;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const [slug, segment, projectId] = parts;

    if (!slug || segment !== ProjectsSegment || !projectId) {
      return;
    }

    if (workspaceSlug && slug !== workspaceSlug) {
      return;
    }

    const issueId = parts[3] === IssuesSegment ? parts[4] : undefined;

    if (issueId) {
      return {
        type: UnfurlResourceType.Issue,
        workspaceSlug: slug,
        projectId,
        issueId,
        url,
      };
    }

    if (parts.length === 3) {
      return {
        type: UnfurlResourceType.Project,
        workspaceSlug: slug,
        projectId,
        url,
      };
    }

    return;
  }
}
