import type { TFunction } from "i18next";
import { Fragment, Slice } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { toast } from "sonner";
import { buildSelectionContext } from "@shared/editor/lib/buildSelectionContext";
import textBetween from "@shared/editor/lib/textBetween";
import type { MenuItem, SelectionContext } from "@shared/editor/types";
import { toError } from "@shared/utils/error";
import type { Editor } from "~/editor";
import type { PluginCommandGroup } from "~/hooks/useEditorCommands";
import Logger from "~/utils/Logger";
import {
  pluginCommandRangePluginKey,
  readRange,
  releaseRange,
  trackRange,
} from "../plugins/PluginCommandRangePlugin";
import type {
  EditorCommand,
  EditorCommandContext,
  ReplaceResult,
} from "./pluginCommandTypes";

/**
 * Measures the bounding rect of a document range within the editor.
 *
 * @param view The editor view to measure within.
 * @param from The start position of the range.
 * @param to The end position of the range.
 * @returns The rect covering the range.
 */
function rectOfRange(view: EditorView, from: number, to: number): DOMRect {
  const fromPos = view.coordsAtPos(from);
  const toPos = view.coordsAtPos(to, -1);
  const top = Math.min(fromPos.top, toPos.top);
  const bottom = Math.max(fromPos.bottom, toPos.bottom);
  const left = Math.min(fromPos.left, toPos.left);
  const right = Math.max(fromPos.right, toPos.right);
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Build the context handed to an editor command. When `track` is true (the
 * default) the current selection is registered with the range-tracking plugin
 * and every range-reading field follows the tracked range as it moves. When
 * false the context is cheap: no token is allocated, `replace` returns
 * "range-lost" and `release` is a no-op.
 *
 * @param editor The editor instance.
 * @param selection A cached selection context, or undefined to derive one.
 * @param options.track Whether to register the selection as a tracked range.
 * @returns The command context.
 */
export function buildCommandContext(
  editor: Editor,
  selection?: SelectionContext,
  options: { track?: boolean } = {}
): EditorCommandContext {
  const { track = true } = options;
  const { view } = editor;

  const selectionCtx =
    selection ??
    buildSelectionContext(view.state, {
      readOnly: !!editor.props.readOnly,
      isTemplate: false,
      rtl: false,
    });

  const token = track
    ? trackRange(view, selectionCtx.selection.from, selectionCtx.selection.to)
    : undefined;

  // Always read fresh from the tracking plugin, never from a captured closure.
  const currentRange = (): { from: number; to: number } | undefined =>
    token ? readRange(view.state, token) : undefined;

  const capturedRange = (): { from: number; to: number } =>
    currentRange() ?? {
      from: selectionCtx.selection.from,
      to: selectionCtx.selection.to,
    };

  let lastAnchorRect: DOMRect | undefined;

  const replace = (
    content: string,
    options?: { asMarkdown?: boolean; addToHistory?: boolean }
  ): ReplaceResult => {
    if (selectionCtx.readOnly || !view.editable) {
      return "read-only";
    }

    const range = currentRange();
    if (!range || range.lost) {
      return "range-lost";
    }

    const { state } = view;
    const slice = options?.asMarkdown
      ? new Slice(editor.parser.parse(content).content, 0, 0)
      : new Slice(Fragment.from(state.schema.text(content)), 0, 0);

    const tr = state.tr.replaceRange(range.from, range.to, slice);
    const to = tr.mapping.map(range.to, -1); // end of what we just wrote

    // Re-track the written span in the same transaction, so repeated calls
    // overwrite the previous chunk instead of appending.
    tr.setMeta(pluginCommandRangePluginKey, {
      track: { token, from: range.from, to },
    });

    if (options?.addToHistory === false) {
      tr.setMeta("addToHistory", false);
    }

    view.dispatch(tr.scrollIntoView());
    return "ok";
  };

  return {
    documentId: editor.props.id,
    view,
    selection: selectionCtx,
    selectedText: (() => {
      const { from, to } = capturedRange();
      return textBetween(view.state.doc, from, to);
    })(),
    getSelectedMarkdown: () => {
      const slice = selectionCtx.selection.content();
      return slice.content.size === 0
        ? ""
        : editor.serializer.serialize(slice.content);
    },
    textBefore: (maxChars = 2000) => {
      const { from } = capturedRange();
      return textBetween(view.state.doc, 0, from).slice(-maxChars);
    },
    textAfter: (maxChars = 2000) => {
      const { to } = capturedRange();
      return textBetween(view.state.doc, to, view.state.doc.content.size).slice(
        0,
        maxChars
      );
    },
    replace,
    isRangeAlive: () => {
      const range = currentRange();
      return !!range && !range.lost;
    },
    release: () => {
      if (token) {
        releaseRange(view, token);
      }
    },
    anchor: {
      getBoundingClientRect: () => {
        try {
          const { from, to } = capturedRange();
          lastAnchorRect = rectOfRange(view, from, to);
        } catch (err) {
          Logger.warn("Unable to measure plugin command range", { err });
        }
        return lastAnchorRect ?? new DOMRect(0, 0, 0, 0);
      },
    },
    containerEl: editor.elementRef.current,
  };
}

/**
 * Invoke a command, releasing the tracked range when `run` throws. The
 * success path is deliberately untouched — `run` owns calling `ctx.release()`.
 *
 * @param command The command to run.
 * @param editor The editor instance.
 * @param selection The selection the command was invoked from.
 * @param t The translation function.
 */
function runCommand(
  command: EditorCommand,
  editor: Editor,
  selection: SelectionContext | undefined,
  t: TFunction
) {
  const ctx = buildCommandContext(editor, selection);
  try {
    command.run(ctx);
  } catch (err) {
    ctx.release();
    Logger.error(`Plugin command "${command.id}" failed`, toError(err));
    toast.error(t("Something went wrong"));
  }
}

/**
 * Build the selection-toolbar entries for plugin selection commands: one
 * collapsed dropdown per plugin, or a flat icon button for a plugin with a
 * single visible command. Plugins without an icon contribute nothing (a
 * warning is logged, because `ToolbarMenu` silently drops icon-less items).
 *
 * @param groups The plugin command groups from `useEditorCommands("selection")`.
 * @param editor The editor instance.
 * @param ctx The current selection context.
 * @param t The translation function.
 * @returns The toolbar menu items to append.
 */
export function buildPluginDropdowns(
  groups: PluginCommandGroup[],
  editor: Editor,
  ctx: SelectionContext,
  t: TFunction
): MenuItem[] {
  const items: MenuItem[] = [];
  const cheapCtx = buildCommandContext(editor, ctx, { track: false });

  for (const group of groups) {
    const visibleCommands = group.commands.filter((command) =>
      command.visible
        ? command.visible(cheapCtx)
        : !ctx.readOnly && !ctx.isEmpty
    );
    if (visibleCommands.length === 0) {
      continue;
    }

    if (!group.icon) {
      Logger.warn(
        `Plugin "${group.pluginName}" registers selection commands but has no icon`,
        { pluginId: group.pluginId }
      );
      continue;
    }

    const toChild = (command: EditorCommand): MenuItem => {
      const title = command.title(t);
      return {
        name: "noop",
        title,
        label: title,
        icon: command.icon,
        onClick: () => runCommand(command, editor, ctx, t),
        children: command.children?.map(toChild),
      };
    };

    if (visibleCommands.length === 1) {
      const command = visibleCommands[0];
      items.push({
        name: "noop",
        icon: group.icon,
        tooltip: command.title(t),
        onClick: () => runCommand(command, editor, ctx, t),
      });
      continue;
    }

    items.push({
      name: "noop",
      icon: group.icon,
      tooltip: group.pluginName,
      children: visibleCommands.map(toChild),
    });
  }

  return items;
}

/**
 * Build the `/`-menu entries for plugin block commands: flat, searchable items
 * grouped under a section header named after the plugin.
 *
 * @param groups The plugin command groups from `useEditorCommands("block")`.
 * @param editor The editor instance.
 * @param t The translation function.
 * @returns The block menu items to append.
 */
export function buildPluginBlockItems(
  groups: PluginCommandGroup[],
  editor: Editor,
  t: TFunction
): MenuItem[] {
  const items: MenuItem[] = [];
  const cheapCtx = buildCommandContext(editor, undefined, { track: false });

  for (const group of groups) {
    const visibleCommands = group.commands.filter((command) =>
      command.visible
        ? command.visible(cheapCtx)
        : !cheapCtx.selection.readOnly
    );
    if (visibleCommands.length === 0) {
      continue;
    }

    for (const command of visibleCommands) {
      const title = command.title(t);
      items.push({
        name: "noop",
        title,
        label: title,
        keywords: command.keywords,
        icon: command.icon,
        section: () => group.pluginName,
        onClick: () => runCommand(command, editor, undefined, t),
      });
    }
  }

  return items;
}
