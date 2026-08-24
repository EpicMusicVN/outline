import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import type { PlaneIssueCard as PlaneIssueCardData } from "../../shared/types";
import EmbedFrame, { ColorDot } from "./EmbedFrame";

type Props = {
  card: PlaneIssueCardData;
  /** Reserved for a future create/edit affordance (P7); unused in the v1 read-only card. */
  isEditable: boolean;
  isSelected: boolean;
};

/** Renders a Plane issue as a card: title, identifier, state, labels and assignees. */
export default function PlaneIssueCard({ card, isSelected }: Props) {
  const { t } = useTranslation();

  return (
    <EmbedFrame
      isSelected={isSelected}
      title={t("Plane issue")}
      canonicalUrl={card.url}
    >
      <Flex column gap={6}>
        <Meta href={card.url} target="_blank" rel="noopener noreferrer">
          <ColorDot $color={card.state.color} aria-hidden />
          <Identifier>{card.id}</Identifier>
          <Text type="tertiary" size="xsmall">
            {card.state.name}
          </Text>
        </Meta>
        <Title href={card.url} target="_blank" rel="noopener noreferrer">
          {card.title}
        </Title>
        {card.description && <Description>{card.description}</Description>}
        {card.labels.length > 0 && (
          <LabelList aria-label={t("Labels")}>
            {card.labels.map((label) => (
              <li key={label.name}>
                <LabelChip>
                  <ColorDot $color={label.color} aria-hidden />
                  {label.name}
                </LabelChip>
              </li>
            ))}
          </LabelList>
        )}
        {card.assignees.length > 0 && (
          <AssigneeList aria-label={t("Assignees")}>
            {card.assignees.map((assignee) => (
              <li key={assignee.name}>
                <Avatar
                  model={{
                    avatarUrl: assignee.avatarUrl || null,
                    name: assignee.name,
                  }}
                  alt={assignee.name}
                  size={AvatarSize.Small}
                  showTooltip
                />
              </li>
            ))}
          </AssigneeList>
        )}
      </Flex>
    </EmbedFrame>
  );
}

const Meta = styled.a`
  display: flex;
  align-items: center;
  gap: 6px;
  color: inherit;

  &:hover {
    text-decoration: none;
  }
`;

const Identifier = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${s("textSecondary")};
`;

const Title = styled.a`
  font-size: 15px;
  font-weight: 600;
  color: ${s("text")} !important;

  &:hover {
    text-decoration: underline;
  }
`;

const Description = styled(Text).attrs({ type: "secondary", size: "small" })`
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const LabelChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: ${s("textSecondary")};
  border: 1px solid ${s("divider")};
  border-radius: 2em;
  padding: 1px 8px;
`;

const LabelList = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
  }
`;

const AssigneeList = styled.ul`
  display: flex;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
`;
