import type {
  EditorCommandContext,
  ReplaceResult,
} from "~/editor/menus/pluginCommandTypes";

/**
 * Writes the accumulated markdown result into the tracked range.
 *
 * `ctx.replace(content, { asMarkdown: true })` already owns the full
 * parse → slice → transaction → position-mapped-dispatch pipeline
 * (`app/editor/menus/pluginCommands.tsx`), including re-tracking the
 * written span. Reimplementing that pipeline here and then separately
 * calling `ctx.replace` would risk two different transactions instead of
 * the required single undo step, so this is a thin, deliberate delegation
 * rather than a wrapper around hand-rolled parsing.
 */
export function applyResult(
  ctx: EditorCommandContext,
  markdown: string
): ReplaceResult {
  return ctx.replace(markdown, { asMarkdown: true });
}
