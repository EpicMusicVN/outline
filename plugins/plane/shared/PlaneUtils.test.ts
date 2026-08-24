import { UnfurlResourceType } from "@shared/types";
import { PlaneUtils } from "./PlaneUtils";

describe("PlaneUtils.parseUrl", () => {
  const baseUrl = "https://plane.example.com";
  const issueUrl =
    "https://plane.example.com/acme/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/issues/9f86d081-884c-7d04-8256-cbd9d14c5b61/";
  const projectUrl = "https://plane.example.com/acme/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/";

  it("should parse an issue URL", () => {
    expect(PlaneUtils.parseUrl(issueUrl, baseUrl)).toEqual({
      type: UnfurlResourceType.Issue,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      issueId: "9f86d081-884c-7d04-8256-cbd9d14c5b61",
      url: issueUrl,
    });
  });

  it("should parse an issue URL without a trailing slash", () => {
    expect(PlaneUtils.parseUrl(issueUrl.replace(/\/$/, ""), baseUrl)).toEqual({
      type: UnfurlResourceType.Issue,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      issueId: "9f86d081-884c-7d04-8256-cbd9d14c5b61",
      url: issueUrl.replace(/\/$/, ""),
    });
  });

  it("should parse an issue URL with extra query parameters", () => {
    expect(PlaneUtils.parseUrl(`${issueUrl}?expand=state&foo=bar`, baseUrl)).toEqual({
      type: UnfurlResourceType.Issue,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      issueId: "9f86d081-884c-7d04-8256-cbd9d14c5b61",
      url: `${issueUrl}?expand=state&foo=bar`,
    });
  });

  it("should parse a project URL", () => {
    expect(PlaneUtils.parseUrl(projectUrl, baseUrl)).toEqual({
      type: UnfurlResourceType.Project,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      url: projectUrl,
    });
  });

  it("should parse a project URL without a trailing slash", () => {
    expect(PlaneUtils.parseUrl(projectUrl.replace(/\/$/, ""), baseUrl)).toEqual({
      type: UnfurlResourceType.Project,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      url: projectUrl.replace(/\/$/, ""),
    });
  });

  it("should accept http and https URLs for the same host", () => {
    const httpUrl = `http://plane.example.com/acme/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/issues/9f86d081-884c-7d04-8256-cbd9d14c5b61/`;
    expect(PlaneUtils.parseUrl(httpUrl, baseUrl)).toEqual({
      type: UnfurlResourceType.Issue,
      workspaceSlug: "acme",
      projectId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      issueId: "9f86d081-884c-7d04-8256-cbd9d14c5b61",
      url: httpUrl,
    });
  });

  it("should reject a URL with the wrong host", () => {
    expect(
      PlaneUtils.parseUrl(
        "https://plane.example.org/acme/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/issues/9f86d081-884c-7d04-8256-cbd9d14c5b61/",
        baseUrl
      )
    ).toBeUndefined();
  });

  it("should reject an unknown path on the correct host", () => {
    expect(
      PlaneUtils.parseUrl("https://plane.example.com/acme/cycles/", baseUrl)
    ).toBeUndefined();
  });

  it("should reject a URL without a workspace slug", () => {
    expect(
      PlaneUtils.parseUrl(
        "https://plane.example.com/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/issues/9f86d081-884c-7d04-8256-cbd9d14c5b61/",
        baseUrl
      )
    ).toBeUndefined();
  });

  it("should reject a URL without a project id", () => {
    expect(
      PlaneUtils.parseUrl("https://plane.example.com/acme/projects/", baseUrl)
    ).toBeUndefined();
  });

  it("should return the URL-derived workspace slug when none is provided", () => {
    const result = PlaneUtils.parseUrl(issueUrl, baseUrl);
    expect(result && result.workspaceSlug).toBe("acme");
  });

  it("should accept a matching workspace slug", () => {
    expect(PlaneUtils.parseUrl(issueUrl, baseUrl, "acme")).toBeDefined();
  });

  it("should reject a mismatched workspace slug", () => {
    expect(PlaneUtils.parseUrl(issueUrl, baseUrl, "other")).toBeUndefined();
  });

  it("should return undefined for malformed input", () => {
    expect(PlaneUtils.parseUrl("not a url", baseUrl)).toBeUndefined();
    expect(PlaneUtils.parseUrl("", baseUrl)).toBeUndefined();
  });

  it("should return undefined for a malformed base URL", () => {
    expect(PlaneUtils.parseUrl(issueUrl, "not a url")).toBeUndefined();
  });
});
