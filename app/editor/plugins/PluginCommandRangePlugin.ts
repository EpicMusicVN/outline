import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { v4 as uuidv4 } from "uuid";

export const pluginCommandRangePluginKey =
  new PluginKey<PluginCommandRangeState>("plugin-command-range");

export interface TrackedRange {
  from: number;
  to: number;
  /** Set once the range is destroyed by an edit; never cleared. */
  lost: boolean;
}

export type PluginCommandRangeState = { ranges: Map<string, TrackedRange> };

interface RangeMeta {
  track?: { token: string; from: number; to: number };
  release?: { token: string };
}

/**
 * Plugin that keeps captured document ranges alive across arbitrary local and
 * remote edits. Every transaction maps each tracked range through
 * `tr.mapping`; a range whose content was deleted is marked `lost` forever.
 * Contributes state only — no decorations, props, or keymaps.
 */
export class PluginCommandRangePlugin extends Plugin<PluginCommandRangeState> {
  constructor() {
    super({
      key: pluginCommandRangePluginKey,
      state: {
        init: (): PluginCommandRangeState => ({ ranges: new Map() }),
        apply: (tr, value): PluginCommandRangeState => {
          const meta = tr.getMeta(pluginCommandRangePluginKey) as
            | RangeMeta
            | undefined;

          if (!meta && (!tr.docChanged || value.ranges.size === 0)) {
            return value;
          }

          let ranges = value.ranges;

          if (tr.docChanged) {
            const mapped = new Map<string, TrackedRange>();
            for (const [token, range] of ranges) {
              const f = tr.mapping.mapResult(range.from, 1);
              const t = tr.mapping.mapResult(range.to, -1);
              const lost =
                range.lost ||
                (f.deleted && t.deleted) ||
                (range.to > range.from && t.pos <= f.pos);
              mapped.set(token, { from: f.pos, to: t.pos, lost });
            }
            ranges = mapped;
          }

          // Track/release are applied after mapping so a `track` issued in the
          // same transaction as a doc change records post-change positions.
          if (meta?.track) {
            ranges = new Map(ranges);
            ranges.set(meta.track.token, {
              from: meta.track.from,
              to: meta.track.to,
              lost: false,
            });
          }

          if (meta?.release) {
            ranges = new Map(ranges);
            ranges.delete(meta.release.token);
          }

          return { ranges };
        },
      },
    });
  }
}

/**
 * Register a range with the tracking plugin, dispatching its own transaction
 * (no steps, so no document change and no history entry).
 *
 * @param view The editor view.
 * @param from The start position of the range.
 * @param to The end position of the range.
 * @returns An opaque token identifying the tracked range.
 */
export function trackRange(view: EditorView, from: number, to: number): string {
  const token = uuidv4();
  const tr = view.state.tr.setMeta(pluginCommandRangePluginKey, {
    track: { token, from, to },
  });
  view.dispatch(tr);
  return token;
}

/**
 * Read the current mapped position and lost state of a tracked range.
 *
 * @param state The editor state.
 * @param token The token returned by `trackRange`.
 * @returns The tracked range, or undefined when the token is unknown.
 */
export function readRange(
  state: EditorState,
  token: string
): TrackedRange | undefined {
  return pluginCommandRangePluginKey.getState(state)?.ranges.get(token);
}

/**
 * Stop tracking a range. The entry is removed from plugin state.
 *
 * @param view The editor view.
 * @param token The token returned by `trackRange`.
 */
export function releaseRange(view: EditorView, token: string): void {
  view.dispatch(
    view.state.tr.setMeta(pluginCommandRangePluginKey, {
      release: { token },
    })
  );
}
