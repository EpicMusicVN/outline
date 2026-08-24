import * as React from "react";
import styled from "styled-components";
import type {
  IssueTrackerIntegrationService,
  UnfurlResourceType,
  UnfurlResponse,
} from "../../types";
import { IntegrationService } from "../../types";
import { GitHubIssueStatusIcon } from "./GitHubIssueStatusIcon";
import { LinearIssueStatusIcon } from "./LinearIssueStatusIcon";
import { GitLabIssueStatusIcon } from "./GitLabIssueStatusIcon";
import { PlaneIssueStatusIcon } from "./PlaneIssueStatusIcon";

export type BaseIconProps = {
  state: UnfurlResponse[UnfurlResourceType.Issue]["state"];
  className?: string;
  size?: number;
};

type Props = BaseIconProps & {
  service: IssueTrackerIntegrationService;
};

export function IssueStatusIcon(props: Props) {
  return (
    <Icon size={props.size} className={props.className}>
      {getIcon(props)}
    </Icon>
  );
}

function getIcon(props: Props) {
  switch (props.service) {
    case IntegrationService.GitHub:
      return <GitHubIssueStatusIcon {...props} />;
    case IntegrationService.Linear:
      return <LinearIssueStatusIcon {...props} />;
    case IntegrationService.GitLab:
      return <GitLabIssueStatusIcon {...props} />;
    case IntegrationService.Plane:
      return <PlaneIssueStatusIcon {...props} />;
    default:
      // Neutral fallback so an unknown provider fails visibly instead of
      // silently rendering another vendor's icon.
      return (
        <svg
          viewBox="0 0 16 16"
          width={props.size ?? 16}
          height={props.size ?? 16}
          fill={props.state.color}
          className={props.className}
        >
          <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
        </svg>
      );
  }
}

const Icon = styled.span<{ size?: number }>`
  display: inline-flex;
  flex-shrink: 0;
  width: ${(props) => props.size ?? 24}px;
  height: ${(props) => props.size ?? 24}px;
  align-items: center;
  justify-content: center;
`;
