import { PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import type { PlaneBoard as PlaneBoardData } from "../../shared/types";
import EmbedFrame, { ColorDot } from "./EmbedFrame";
import PlaneCreateIssueDialog from "./PlaneCreateIssueDialog";

type Props = {
  board: PlaneBoardData;
  /** Shows the "New issue" affordance (Open Question 2, option a) when true. */
  isEditable: boolean;
  isSelected: boolean;
};

/** Renders a Plane project as a mini-board: columns grouped by state. */
export default function PlaneBoard({ board, isEditable, isSelected }: Props) {
  const { t } = useTranslation();
  const itemCount = board.columns.reduce(
    (sum, column) => sum + column.items.length,
    0
  );
  const [isCreateOpen, setCreateOpen] = React.useState(false);

  return (
    <EmbedFrame
      isSelected={isSelected}
      title={board.name}
      canonicalUrl={board.url}
    >
      {isEditable && (
        <Toolbar justify="flex-end">
          <Button neutral onClick={() => setCreateOpen(true)}>
            <PlusIcon size={16} /> {t("New issue")}
          </Button>
        </Toolbar>
      )}
      {board.hasMore && (
        <HasMoreNotice type="tertiary" size="xsmall">
          {t("Showing the first {{count}} items · view the rest in Plane", {
            count: itemCount,
          })}
        </HasMoreNotice>
      )}
      {board.columns.length === 0 ? (
        <Text type="tertiary" size="small">
          {t("This project has no items yet.")}
        </Text>
      ) : (
        <Columns>
          {board.columns.map((column) => (
            <Column
              key={column.state.id}
              aria-labelledby={`plane-board-column-${column.state.id}`}
            >
              <ColumnHeader id={`plane-board-column-${column.state.id}`}>
                <ColorDot $color={column.state.color} aria-hidden />
                <ColumnName>{column.state.name}</ColumnName>
                <Text type="tertiary" size="xsmall">
                  {column.items.length}
                </Text>
              </ColumnHeader>
              <ItemList>
                {column.items.map((item) => (
                  <li key={item.id}>
                    <Item
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ItemIdentifier>{item.id}</ItemIdentifier>
                      <ItemTitle>{item.title}</ItemTitle>
                      {(item.labels.length > 0 ||
                        item.assignees.length > 0) && (
                        <ItemMeta>
                          {item.labels.map((label) => (
                            <ColorDot
                              key={label.name}
                              $color={label.color}
                              aria-label={label.name}
                              title={label.name}
                            />
                          ))}
                          {item.assignees.map((assignee) => (
                            <Avatar
                              key={assignee.name}
                              model={{
                                avatarUrl: assignee.avatarUrl || null,
                                name: assignee.name,
                              }}
                              alt={assignee.name}
                              size={AvatarSize.Small}
                              showTooltip
                            />
                          ))}
                        </ItemMeta>
                      )}
                    </Item>
                  </li>
                ))}
              </ItemList>
            </Column>
          ))}
        </Columns>
      )}
      {isCreateOpen && (
        <PlaneCreateIssueDialog
          projectId={board.id}
          onRequestClose={() => setCreateOpen(false)}
        />
      )}
    </EmbedFrame>
  );
}

const HasMoreNotice = styled(Text)`
  display: block;
  margin-bottom: 8px;
`;

const Columns = styled.div`
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
`;

const Column = styled.section`
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ColumnHeader = styled.h4`
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
`;

const ColumnName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`;

const ItemList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Item = styled.a`
  display: block;
  border: 1px solid ${s("divider")};
  border-radius: 4px;
  padding: 6px 8px;
  color: inherit;

  &:hover {
    text-decoration: none;
    border-color: ${s("textSecondary")};
  }
`;

const ItemIdentifier = styled.span`
  display: block;
  font-size: 12px;
  color: ${s("textSecondary")};
`;

const ItemTitle = styled.span`
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: ${s("text")};
`;

const ItemMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
`;

const Toolbar = styled(Flex)`
  padding: 8px 16px 0;
`;
