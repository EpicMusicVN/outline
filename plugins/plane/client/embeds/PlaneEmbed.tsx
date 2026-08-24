import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import type { EmbedProps } from "@shared/editor/embeds";
import { s } from "@shared/styles";
import { UnfurlResourceType } from "@shared/types";
import { integrationSettingsPath } from "@shared/utils/routeHelpers";
import Flex from "~/components/Flex";
import PlaceholderText from "~/components/PlaceholderText";
import { PlaneInfoStatus } from "../../shared/types";
import EmbedFrame from "./EmbedFrame";
import PlaneBoard from "./PlaneBoard";
import PlaneIssueCard from "./PlaneIssueCard";
import { usePlaneInfo } from "./usePlaneInfo";

/**
 * The Plane embed's ProseMirror node view. Fetches `plane.info` for the
 * matched URL and renders a loading skeleton, an issue card, a project
 * board, or one of the not-found / error / reconnect-required states — an
 * embed stuck on a spinner or gone blank on disconnect is a support ticket.
 */
function PlaneEmbed({ attrs, isEditable, isSelected }: EmbedProps) {
  const { t } = useTranslation();
  const state = usePlaneInfo(attrs.href);

  if (state.status === "loading") {
    return (
      <EmbedFrame
        isSelected={isSelected}
        title={t("Plane")}
        canonicalUrl={attrs.href}
      >
        <Flex column gap={8}>
          <PlaceholderText header minWidth={30} maxWidth={50} />
          <PlaceholderText minWidth={70} maxWidth={100} />
          <PlaceholderText minWidth={40} maxWidth={60} />
        </Flex>
      </EmbedFrame>
    );
  }

  if (state.status === "not_found") {
    return (
      <EmbedFrame
        isSelected={isSelected}
        title={t("Plane")}
        canonicalUrl={attrs.href}
      >
        <Message role="status">
          {t("This Plane issue or project could not be found.")}
        </Message>
      </EmbedFrame>
    );
  }

  if (state.status === "error") {
    return (
      <EmbedFrame
        isSelected={isSelected}
        title={t("Plane")}
        canonicalUrl={attrs.href}
      >
        <Message role="alert">{t("Couldn't load this Plane link.")}</Message>
      </EmbedFrame>
    );
  }

  if (state.data.type === PlaneInfoStatus.ReconnectRequired) {
    return (
      <EmbedFrame
        isSelected={isSelected}
        title={t("Plane")}
        canonicalUrl={attrs.href}
      >
        <Message role="alert">
          {t("Plane needs to be reconnected to show this preview.")}{" "}
          <Link to={integrationSettingsPath("plane")}>
            {t("Manage connection")}
          </Link>
        </Message>
      </EmbedFrame>
    );
  }

  if (state.data.type === UnfurlResourceType.Issue) {
    return (
      <PlaneIssueCard
        card={state.data}
        isEditable={isEditable}
        isSelected={isSelected}
      />
    );
  }

  return (
    <PlaneBoard
      board={state.data}
      isEditable={isEditable}
      isSelected={isSelected}
    />
  );
}

const Message = styled.p`
  margin: 0;
  color: ${s("textSecondary")};
  font-size: 14px;
`;

export default PlaneEmbed;
