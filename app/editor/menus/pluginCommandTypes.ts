import type { TFunction } from "i18next";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import type { SelectionContext } from "@shared/editor/types";

/**
 * Where a plugin editor command surfaces in the editor UI.
 */
export type EditorCommandGroup = "selection" | "block";

/**
 * Outcome of `ctx.replace()`.
 */
export type ReplaceResult =
  /** Content was written in a single transaction. */
  | "ok"
  /** Editor is read-only; nothing was written. */
  | "read-only"
  /** The tracked range no longer exists in the document; nothing was written. */
  | "range-lost";

/**
 * Context handed to an editor command when it runs. The tracked range is
 * registered with the range-tracking plugin before `run` is invoked, so every
 * field that reads the range stays correct across concurrent local and remote
 * edits for the lifetime of the command.
 */
export interface EditorCommandContext {
  /** Id of the document being edited; undefined outside a document editor. */
  documentId: string | undefined;
  /**
   * The live ProseMirror view. Escape hatch: anything not covered by the
   * helpers below can be derived from `view.state`. Its presence is what
   * guarantees this seam never needs widening for a new plugin need.
   */
  view: EditorView;
  /** Cached selection facts (state, schema, selection, readOnly, isInCode…). */
  selection: SelectionContext;
  /** Plain text of the selection captured when the command ran; "" if empty. */
  selectedText: string;
  /** Markdown for the captured selection; "" if empty. Computed on demand. */
  getSelectedMarkdown: () => string;
  /**
   * Plain text immediately preceding the captured range, most recent last,
   * truncated to the last `maxChars` characters (default 2000). Computed on
   * demand against the *current* document.
   */
  textBefore: (maxChars?: number) => string;
  /** Mirror of `textBefore` for text following the captured range. */
  textAfter: (maxChars?: number) => string;
  /**
   * Replace the tracked range in exactly ONE ProseMirror transaction.
   * Returns "read-only" when the editor is not editable, "range-lost" (a
   * silent no-op — the caller decides the UX) when the tracked range was
   * destroyed by an edit, and "ok" otherwise. The written span is re-tracked
   * in the same transaction, so calling `replace` again overwrites what the
   * previous call wrote — pass `addToHistory: false` for intermediate chunks
   * of a stream and `true` for the final one so the stream collapses toward a
   * single undo entry.
   */
  replace: (
    content: string,
    options?: { asMarkdown?: boolean; addToHistory?: boolean }
  ) => ReplaceResult;
  /** Whether the tracked range still exists. False after a destructive edit. */
  isRangeAlive: () => boolean;
  /**
   * Stop tracking the range. MUST be called when the command finishes or is
   * cancelled, or the tracked entry leaks for the life of the editor. Core
   * additionally releases the range when the command throws and when the
   * editor view is destroyed.
   */
  release: () => void;
  /**
   * Virtual anchor for popovers; pass to a Radix `virtualRef`. Tracks the
   * range as it moves, so a popover stays pinned during concurrent edits.
   * Falls back to the last known rect when measurement fails.
   */
  anchor: { getBoundingClientRect: () => DOMRect };
  /** Editor container element — portal target for popovers. */
  containerEl: HTMLElement | null;
}

/**
 * An editor command contributed by a plugin. Plugins register an array of
 * these under `Hook.EditorCommand` in a single `PluginManager.add` call.
 */
export interface EditorCommand {
  /** Unique within the plugin. Namespaced by core as `${plugin.id}.${id}`. */
  id: string;
  /** Label resolver. Core writes the result to both `title` and `label`. */
  title: (t: TFunction) => string;
  /** Icon. Required on the first selection command if the plugin registers no `Hook.Icon`. */
  icon?: React.ReactNode;
  /** Extra search terms for the "/" menu. */
  keywords?: string;
  /** Where the command surfaces. */
  group: EditorCommandGroup;
  /** Tooltip for the toolbar entry. Defaults to `title`. */
  tooltip?: (t: TFunction) => string;
  /**
   * Visibility predicate. Default when omitted (permissive):
   *   selection → `!ctx.selection.readOnly && !ctx.selection.isEmpty`
   *   block     → `!ctx.selection.readOnly`
   * Receives a *cheap* context: `replace`/`release` are inert here, because
   * no range is tracked until the command actually runs.
   */
  visible?: (ctx: EditorCommandContext) => boolean;
  /** Nested commands — rendered as a submenu inside the plugin dropdown. */
  children?: EditorCommand[];
  /**
   * Invoked on click / Enter with a context whose range is already tracked.
   * Must not throw; core catches, logs and toasts. The command owns calling
   * `ctx.release()`.
   */
  run: (ctx: EditorCommandContext) => void;
}
