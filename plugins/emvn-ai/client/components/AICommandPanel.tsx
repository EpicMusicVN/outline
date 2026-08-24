import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import { InputSelect } from "~/components/InputSelect";
import type { Option } from "~/components/InputSelect";
import Text from "~/components/Text";
import type { AICommandResultMode } from "../../shared/commands";
import type { PublicAITarget } from "../../shared/types";
import type { StreamPhase } from "../accumulate";

export type AICommandPanelProps = {
  result: string;
  status: string;
  phase: StreamPhase;
  message?: string;
  resultMode: AICommandResultMode;
  /** Present only when more than one target is configured. */
  targets?: PublicAITarget[];
  selectedTargetId?: string;
  onTargetChange?: (targetId: string) => void;
  onAccept: () => void;
  onInsert: () => void;
  onDiscard: () => void;
  onCopy: () => void;
  onStop: () => void;
  onRetry: () => void;
};

/**
 * Presentational only — the streaming hook, target persistence, and the
 * write-to-document call all live in the plugin's command runner. Result and
 * status are always rendered as plain text so reasoning can never be
 * mistaken for, or accidentally rendered as, document content.
 */
export default function AICommandPanel({
  result,
  status,
  phase,
  message,
  resultMode,
  targets,
  selectedTargetId,
  onTargetChange,
  onAccept,
  onInsert,
  onDiscard,
  onCopy,
  onStop,
  onRetry,
}: AICommandPanelProps) {
  const targetOptions: Option[] = React.useMemo(
    () =>
      (targets ?? []).map((target) => ({
        type: "item",
        label: target.label,
        value: target.id,
      })),
    [targets]
  );

  return (
    <Panel>
      {targets && targets.length > 1 && onTargetChange && (
        <InputSelect
          label="AI target"
          labelHidden
          value={selectedTargetId}
          onChange={onTargetChange}
          options={targetOptions}
        />
      )}
      <Body>
        {phase === "failed" && (
          <Text type="danger" size="small" weight="bold" selectable>
            {message}
          </Text>
        )}
        {(phase !== "failed" || result) && (
          <Result size="small" selectable>
            {result}
          </Result>
        )}
        {phase === "streaming" && !result && !status && (
          <Text type="tertiary" size="small">
            Generating…
          </Text>
        )}
        {phase === "streaming" && status && (
          <Status type="tertiary" size="xsmall" italic>
            {status}
          </Status>
        )}
      </Body>
      <Footer gap={8}>
        {phase === "streaming" && (
          <Button neutral onClick={onStop}>
            Stop
          </Button>
        )}
        {phase === "complete" && resultMode === "replace" && (
          <>
            <Button onClick={onAccept}>Accept</Button>
            <Button neutral onClick={onDiscard}>
              Discard
            </Button>
          </>
        )}
        {phase === "complete" && resultMode === "insert" && (
          <>
            <Button onClick={onInsert}>Insert</Button>
            <Button neutral onClick={onCopy}>
              Copy
            </Button>
            <Button neutral onClick={onDiscard}>
              Discard
            </Button>
          </>
        )}
        {phase === "failed" && (
          <>
            <Button onClick={onRetry}>Retry</Button>
            {result && (
              <Button neutral onClick={onCopy}>
                Copy
              </Button>
            )}
          </>
        )}
      </Footer>
    </Panel>
  );
}

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 320px;
  max-width: 420px;
  padding: 12px;
  border-radius: 6px;
  background: ${s("menuBackground")};
  box-shadow: rgba(0, 0, 0, 0.2) 0px 4px 16px;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
`;

const Result = styled(Text)`
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
`;

const Status = styled(Text)`
  display: block;
`;

const Footer = styled(Flex)`
  justify-content: flex-end;
`;
