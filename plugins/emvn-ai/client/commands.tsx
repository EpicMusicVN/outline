import * as Popover from "@radix-ui/react-popover";
import * as React from "react";
import ReactDOM from "react-dom";
import { languageOptions } from "@shared/i18n";
import type {
  EditorCommand,
  EditorCommandContext,
} from "~/editor/menus/pluginCommandTypes";
import env from "~/env";
import { applyResult } from "./applyResult";
import AICommandPanel from "./components/AICommandPanel";
import { useAICommandStream } from "./hooks/useAICommandStream";
import { AICommandId, AICommandMetadataMap } from "../shared/commands";
import type { AICommandRequest, PublicAITarget } from "../shared/types";

type PendingRequest = Omit<AICommandRequest, "targetId">;

const TARGET_STORAGE_KEY = "emvn-ai:targetId";

/**
 * Resolves a language code (from `EMVN_AI_TRANSLATE_LANGUAGES`, e.g. "en" or
 * a full locale like "vi_VN") to its display name via the existing i18n
 * language table, rather than a hand-written label map. Falls back to the
 * raw code for anything not present in that table.
 */
function languageLabel(code: string): string {
  const exact = languageOptions.find((option) => option.value === code);
  if (exact) {
    return exact.label;
  }
  const prefix = `${code.split(/[-_]/)[0].toLowerCase()}_`;
  const byPrefix = languageOptions.find((option) =>
    option.value.toLowerCase().startsWith(prefix)
  );
  return byPrefix?.label ?? code;
}

function resolveInitialTargetId(targets: PublicAITarget[]): string {
  if (targets.length === 1) {
    return targets[0].id;
  }
  const stored = window.localStorage.getItem(TARGET_STORAGE_KEY);
  return stored && targets.some((target) => target.id === stored)
    ? stored
    : targets[0].id;
}

type RunnerProps = {
  ctx: EditorCommandContext;
  request: PendingRequest;
  targets: PublicAITarget[];
  onClose: () => void;
};

function AICommandRunner({ ctx, request, targets, onClose }: RunnerProps) {
  const { state, start, cancel } = useAICommandStream();
  const [targetId, setTargetId] = React.useState(() =>
    resolveInitialTargetId(targets)
  );
  const metadata = AICommandMetadataMap[request.commandId];

  React.useEffect(() => {
    start({ ...request, targetId });
    // Runs once on mount; target changes re-invoke `start` explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDiscard = React.useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  const handleApply = React.useCallback(() => {
    applyResult(ctx, state.result);
    onClose();
  }, [ctx, state.result, onClose]);

  const handleCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(state.result).catch(() => undefined);
  }, [state.result]);

  const handleTargetChange = React.useCallback(
    (id: string) => {
      setTargetId(id);
      window.localStorage.setItem(TARGET_STORAGE_KEY, id);
      start({ ...request, targetId: id });
    },
    [request, start]
  );

  const handleRetry = React.useCallback(() => {
    start({ ...request, targetId });
  }, [request, start, targetId]);

  return (
    <Popover.Root
      defaultOpen
      onOpenChange={(open) => {
        if (!open) {
          handleDiscard();
        }
      }}
    >
      <Popover.Anchor virtualRef={{ current: ctx.anchor }} />
      <Popover.Portal>
        <Popover.Content sideOffset={8}>
          <AICommandPanel
            result={state.result}
            status={state.status}
            phase={state.phase}
            message={state.message}
            resultMode={metadata.resultMode}
            targets={targets.length > 1 ? targets : undefined}
            selectedTargetId={targetId}
            onTargetChange={handleTargetChange}
            onAccept={handleApply}
            onInsert={handleApply}
            onDiscard={handleDiscard}
            onCopy={handleCopy}
            onStop={cancel}
            onRetry={handleRetry}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function mountAICommandPanel(
  ctx: EditorCommandContext,
  request: PendingRequest
) {
  const container = ctx.containerEl;
  if (!container) {
    ctx.release();
    return;
  }

  const targets = (env.EMVN_AI_TARGET_OPTIONS ?? []) as PublicAITarget[];
  const mount = document.createElement("div");
  mount.style.position = "absolute";
  container.appendChild(mount);

  const close = () => {
    ReactDOM.unmountComponentAtNode(mount);
    if (mount.parentElement) {
      mount.parentElement.removeChild(mount);
    }
    ctx.release();
  };

  ReactDOM.render(
    <AICommandRunner
      ctx={ctx}
      request={request}
      targets={targets}
      onClose={close}
    />,
    mount
  );
}

function buildRequest(
  ctx: EditorCommandContext,
  commandId: AICommandId,
  language?: string
): PendingRequest | undefined {
  const metadata = AICommandMetadataMap[commandId];
  const text = metadata.requiresSelection ? ctx.selectedText : ctx.textBefore();
  if (!text || !ctx.documentId) {
    return undefined;
  }
  return {
    commandId,
    text,
    documentId: ctx.documentId,
    ...(metadata.hasLanguageParam && language ? { language } : {}),
  };
}

function runAICommand(
  ctx: EditorCommandContext,
  commandId: AICommandId,
  language?: string
) {
  const request = buildRequest(ctx, commandId, language);
  if (!request) {
    ctx.release();
    return;
  }
  mountAICommandPanel(ctx, request);
}

function buildTranslateChildren(): EditorCommand[] {
  const codes = String(env.EMVN_AI_TRANSLATE_LANGUAGES ?? "en,vi")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  return codes.map((code) => ({
    id: `translate.${code}`,
    title: () => languageLabel(code),
    group: "selection",
    run: (ctx) => runAICommand(ctx, AICommandId.Translate, code),
  }));
}

const summarizeCommand: EditorCommand = {
  id: "summarize",
  title: () => "Summarize",
  keywords: "summarize ai",
  group: "selection",
  run: (ctx) => runAICommand(ctx, AICommandId.Summarize),
};

const rewriteCommand: EditorCommand = {
  id: "rewrite",
  title: () => "Rewrite",
  keywords: "rewrite ai",
  group: "selection",
  run: (ctx) => runAICommand(ctx, AICommandId.Rewrite),
};

const continueWritingCommand: EditorCommand = {
  id: "continueWriting",
  title: () => "Continue writing",
  keywords: "continue writing ai",
  group: "block",
  run: (ctx) => runAICommand(ctx, AICommandId.ContinueWriting),
};

const translateCommand: EditorCommand = {
  id: "translate",
  title: () => "Translate",
  keywords: "translate ai language",
  group: "selection",
  // With more than one visible sibling command in this group — always true
  // here, since summarize/rewrite/translate share the same default
  // visibility predicate — `buildPluginDropdowns` renders this entry only
  // as a submenu trigger and never calls its `run` (app/editor/menus/
  // pluginCommands.tsx:247-263). Kept as a safe no-op because
  // `EditorCommand.run` is required by the type.
  run: (ctx) => ctx.release(),
  children: buildTranslateChildren(),
};

export const commands: EditorCommand[] = [
  summarizeCommand,
  rewriteCommand,
  continueWritingCommand,
  translateCommand,
];
