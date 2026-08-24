import { OpenIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { sanitizeUrl } from "@shared/utils/urls";
import PlaneIcon from "../components/Icon";

type Props = {
  /** Whether the embed's ProseMirror node is currently selected */
  isSelected?: boolean;
  /** The label shown in the footer bar, e.g. the issue or project name */
  title: string;
  /** The Plane URL the footer's "Open" link points to */
  canonicalUrl: string;
  children: React.ReactNode;
};

/**
 * Shared chrome for every rendered state of the Plane embed (loading, error,
 * card, board): a bordered frame with a footer bar carrying the Plane icon
 * and a link out to the source URL, matching the built-in iframe embeds'
 * `Frame` component (`shared/editor/components/Frame.tsx`).
 */
export default function EmbedFrame({
  isSelected,
  title,
  canonicalUrl,
  children,
}: Props) {
  const { t } = useTranslation();

  return (
    <Rounded className={isSelected ? "ProseMirror-selectednode" : undefined}>
      <Content>{children}</Content>
      <Bar>
        <PlaneIcon size={16} />
        <Title>{title}</Title>
        <Open
          href={sanitizeUrl(canonicalUrl)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <OpenIcon size={16} /> {t("Open")}
        </Open>
      </Bar>
    </Rounded>
  );
}

/** A small colored dot representing a Plane state or label color. */
export const ColorDot = styled.span<{ $color: string }>`
  display: inline-block;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) => props.$color};
`;

const Rounded = styled.div`
  border: 1px solid ${(props) => props.theme.embedBorder};
  border-radius: 6px;
  overflow: hidden;
`;

const Content = styled.div`
  padding: 12px 16px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid ${(props) => props.theme.embedBorder};
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  padding: 0 8px;
  height: 28px;
  position: relative;
`;

const Title = styled.span`
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Open = styled.a`
  color: ${s("textSecondary")} !important;
  font-size: 13px;
  font-weight: 500;
  align-items: center;
  display: flex;
  gap: 4px;
  position: absolute;
  right: 8px;
`;
