import { TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ySyncPluginKey } from "y-prosemirror";
import { createEditorState, doc, p } from "@shared/test/editor";
import {
  PluginCommandRangePlugin,
  pluginCommandRangePluginKey,
  readRange,
  releaseRange,
  trackRange,
} from "./PluginCommandRangePlugin";

function createState() {
  return createEditorState(
    doc([p("hello world"), p("second paragraph")]),
    [new PluginCommandRangePlugin()]
  );
}

function track(state: EditorState, from: number, to: number, token = "token") {
  const tr = state.tr.setMeta(pluginCommandRangePluginKey, {
    track: { token, from, to },
  });
  return state.apply(tr);
}

describe("PluginCommandRangePlugin", () => {
  it("shifts the range when text is inserted before it", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.insertText("XX", 1));
    expect(readRange(next, "token")).toEqual({ from: 9, to: 14, lost: false });
  });

  it("grows the range when text is inserted inside it", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.insertText("YY", 8));
    expect(readRange(next, "token")).toEqual({ from: 7, to: 14, lost: false });
  });

  it("keeps the range put when text is inserted immediately after it", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.insertText("ZZ", 12));
    expect(readRange(next, "token")).toEqual({ from: 7, to: 12, lost: false });
  });

  it("shifts the range back when a span entirely before it is deleted", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.delete(1, 3));
    expect(readRange(next, "token")).toEqual({ from: 5, to: 10, lost: false });
  });

  it("leaves the range unchanged when a span entirely after it is deleted", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.delete(14, 16));
    expect(readRange(next, "token")).toEqual({ from: 7, to: 12, lost: false });
  });

  it("shrinks the range when a span overlaps one endpoint", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.delete(5, 9));
    expect(readRange(next, "token")).toEqual({ from: 5, to: 8, lost: false });
  });

  it("marks the range lost when a span covers it entirely", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(state.tr.delete(7, 12));
    const range = readRange(next, "token");
    expect(range?.lost).toBe(true);
    expect(range?.from).toBe(7);
    expect(range?.to).toBe(7);
  });

  it("marks the range lost when the whole doc is replaced", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, p("x"))
    );
    expect(readRange(next, "token")?.lost).toBe(true);
  });

  it("keeps lost sticky across subsequent edits", () => {
    const state = track(createState(), 7, 12);
    const afterDelete = state.apply(state.tr.delete(7, 12));
    const afterRestore = afterDelete.apply(
      afterDelete.tr.insertText("world", 7)
    );
    expect(readRange(afterRestore, "token")?.lost).toBe(true);
  });

  it("maps a remote-shaped transaction identically to a local one", () => {
    const localState = track(createState(), 7, 12);
    const local = localState.apply(localState.tr.insertText("XX", 1));
    const remoteState = track(createState(), 7, 12);
    const remote = remoteState.apply(
      remoteState.tr
        .insertText("XX", 1)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true })
    );
    expect(readRange(remote, "token")).toEqual(readRange(local, "token"));
    expect(readRange(remote, "token")).toEqual({
      from: 9,
      to: 14,
      lost: false,
    });
  });

  it("records post-change positions when a transaction carries track and a doc change", () => {
    const state = createState();
    const tr = state.tr.insertText("QQ", 1);
    tr.setMeta(pluginCommandRangePluginKey, {
      track: { token: "post", from: 1, to: 3 },
    });
    const next = state.apply(tr);
    expect(readRange(next, "post")).toEqual({ from: 1, to: 3, lost: false });
  });

  it("removes the entry on release", () => {
    const state = track(createState(), 7, 12);
    const next = state.apply(
      state.tr.setMeta(pluginCommandRangePluginKey, {
        release: { token: "token" },
      })
    );
    expect(readRange(next, "token")).toBeUndefined();
  });

  it("returns the identical state object when there is no meta and no doc change", () => {
    const state = track(createState(), 7, 12);
    const tr = state.tr.setSelection(
      TextSelection.near(state.doc.resolve(1))
    );
    const next = state.apply(tr);
    expect(pluginCommandRangePluginKey.getState(next)).toBe(
      pluginCommandRangePluginKey.getState(state)
    );
  });

  it("keeps an empty ranges map untouched by unrelated doc changes", () => {
    const state = createState();
    const next = state.apply(state.tr.insertText("XX", 1));
    expect(pluginCommandRangePluginKey.getState(next)).toBe(
      pluginCommandRangePluginKey.getState(state)
    );
  });

  describe("view helpers", () => {
    it("trackRange dispatches and readRange/releaseRange round-trip", () => {
      const view = new EditorView(document.createElement("div"), {
        state: createState(),
      });

      const token = trackRange(view, 7, 12);
      expect(readRange(view.state, token)).toEqual({
        from: 7,
        to: 12,
        lost: false,
      });

      view.dispatch(view.state.tr.insertText("XX", 1));
      expect(readRange(view.state, token)).toEqual({
        from: 9,
        to: 14,
        lost: false,
      });

      releaseRange(view, token);
      expect(readRange(view.state, token)).toBeUndefined();

      view.destroy();
    });
  });
});
