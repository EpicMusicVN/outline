import type { TFunction } from "i18next";
import type * as React from "react";
import { TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { buildSelectionContext } from "@shared/editor/lib/buildSelectionContext";
import textBetween from "@shared/editor/lib/textBetween";
import {
  createEditorState,
  doc,
  p,
  parser,
  serializer,
} from "@shared/test/editor";
import type { Editor } from "~/editor";
import type { MenuItem, SelectionContext } from "@shared/editor/types";
import type { PluginCommandGroup } from "~/hooks/useEditorCommands";
import Logger from "~/utils/Logger";
import { PluginCommandRangePlugin } from "../plugins/PluginCommandRangePlugin";
import {
  buildCommandContext,
  buildPluginBlockItems,
  buildPluginDropdowns,
} from "./pluginCommands";
import type {
  EditorCommand,
  EditorCommandContext,
  EditorCommandGroup,
} from "./pluginCommandTypes";

const t = ((key: string) => key) as TFunction;

function createState() {
  return createEditorState(
    doc([p("hello world"), p("second paragraph")]),
    [new PluginCommandRangePlugin()]
  );
}

function select(state: EditorState, from: number, to: number) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to))
  );
}

function docText(state: EditorState) {
  return textBetween(state.doc, 0, state.doc.content.size);
}

function createEditorMock(
  state?: EditorState,
  options: { id?: string; readOnly?: boolean } = {}
) {
  const editor = {
    props: {
      id: options.id ?? "doc-1",
      readOnly: options.readOnly ?? false,
    },
    view: new EditorView(document.createElement("div"), {
      state: state ?? createState(),
    }),
    parser,
    serializer,
    elementRef: { current: document.createElement("div") },
  } as unknown as Editor;

  return {
    editor,
    view: editor.view,
    dispose: () => {
      editor.view.destroy();
    },
  };
}

function selectionCtx(
  view: EditorView,
  options: { readOnly?: boolean } = {}
): SelectionContext {
  return buildSelectionContext(view.state, {
    readOnly: options.readOnly ?? false,
    isTemplate: false,
    rtl: false,
  });
}

function makeCommand(
  id: string,
  group: EditorCommandGroup = "selection",
  run = vi.fn()
): EditorCommand {
  return {
    id,
    title: () => `Title ${id}`,
    group,
    icon: "icon",
    run,
  };
}

function makeGroup(
  pluginId: string,
  commands: EditorCommand[],
  icon: React.ReactNode = "icon"
): PluginCommandGroup {
  return {
    pluginId,
    pluginName: `Plugin ${pluginId}`,
    icon,
    commands,
  };
}

describe("buildCommandContext", () => {
  it("exposes documentId, the selection context and the container element", () => {
    const { editor, view, dispose } = createEditorMock();

    const ctx = buildCommandContext(editor, selectionCtx(view));

    expect(ctx.documentId).toBe("doc-1");
    expect(ctx.selectedText).toBe("");
    expect(ctx.selection.isEmpty).toBe(true);
    expect(ctx.containerEl).toBeInstanceOf(HTMLDivElement);

    dispose();
  });

  it("reads selected text and surrounding text from the tracked range", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    expect(ctx.selectedText).toBe("world");
    expect(ctx.getSelectedMarkdown()).toBe("world");
    expect(ctx.textBefore()).toBe("hello ");
    expect(ctx.textBefore(3)).toBe("lo ");
    expect(ctx.textAfter(5)).toBe("\nseco");
    expect(ctx.textAfter()).toBe("\nsecond paragraph");

    dispose();
  });

  it("clamps textBefore and textAfter at the document bounds", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 1, 2)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    expect(ctx.textBefore(500)).toBe("");
    expect(ctx.textAfter(500)).toBe("ello world\nsecond paragraph");

    dispose();
  });

  it("replace dispatches exactly one transaction and re-tracks the written span", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    const dispatch = vi.spyOn(view, "dispatch");
    expect(ctx.replace("HELLO")).toBe("ok");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(docText(view.state)).toBe("hello HELLO\nsecond paragraph");

    // The written span is re-tracked, so a second replace overwrites it.
    dispatch.mockClear();
    expect(ctx.replace("X")).toBe("ok");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(docText(view.state)).toBe("hello X\nsecond paragraph");

    dispose();
  });

  it("replace returns read-only and writes nothing when the editor is not editable", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(
      editor,
      selectionCtx(view, { readOnly: true })
    );

    const dispatch = vi.spyOn(view, "dispatch");
    expect(ctx.replace("X")).toBe("read-only");
    expect(dispatch).not.toHaveBeenCalled();
    expect(docText(view.state)).toBe("hello world\nsecond paragraph");

    dispose();
  });

  it("replace lands at the mapped position after a concurrent edit above", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    view.dispatch(view.state.tr.insertText("INSERTED ", 1));

    expect(ctx.replace("X")).toBe("ok");
    expect(docText(view.state)).toBe("INSERTED hello X\nsecond paragraph");

    dispose();
  });

  it("replace returns range-lost and dispatches nothing after the range is deleted", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    view.dispatch(view.state.tr.delete(7, 12));

    expect(ctx.isRangeAlive()).toBe(false);
    const dispatch = vi.spyOn(view, "dispatch");
    expect(ctx.replace("X")).toBe("range-lost");
    expect(dispatch).not.toHaveBeenCalled();
    expect(docText(view.state)).toBe("hello \nsecond paragraph");

    dispose();
  });

  it("release stops tracking and invalidates replace", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    expect(ctx.isRangeAlive()).toBe(true);
    ctx.release();
    expect(ctx.isRangeAlive()).toBe(false);
    expect(ctx.replace("X")).toBe("range-lost");

    dispose();
  });

  it("anchor exposes a DOMRect and falls back gracefully", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const ctx = buildCommandContext(editor, selectionCtx(view));

    const rect = ctx.anchor.getBoundingClientRect();
    expect(rect).toBeInstanceOf(DOMRect);
    expect(typeof rect.left).toBe("number");
    expect(typeof rect.width).toBe("number");

    dispose();
  });

  it("visible checks use a cheap context without allocating a token", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    let seen: EditorCommandContext | undefined;
    const command = makeCommand("vis", "selection");
    command.visible = (ctx) => {
      seen = ctx;
      return true;
    };

    buildPluginDropdowns(
      [makeGroup("ai", [command])],
      editor,
      selectionCtx(view),
      t
    );

    expect(seen?.replace("X")).toBe("range-lost");
    seen?.release();
    expect(docText(view.state)).toBe("hello world\nsecond paragraph");

    dispose();
  });
});

describe("buildPluginDropdowns", () => {
  it("builds one collapsed dropdown per plugin", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const groups = [
      makeGroup("ai", [makeCommand("a"), makeCommand("b")]),
      makeGroup("other", [makeCommand("c"), makeCommand("d")]),
    ];

    const items = buildPluginDropdowns(groups, editor, selectionCtx(view), t);

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.name).toBe("noop");
      expect(item.icon).toBeDefined();
      expect(item.children).toHaveLength(2);
    }

    dispose();
  });

  it("flattens a single-command plugin to a flat icon button", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const items = buildPluginDropdowns(
      [makeGroup("ai", [makeCommand("only")])],
      editor,
      selectionCtx(view),
      t
    );

    expect(items).toHaveLength(1);
    expect(items[0].children).toBeUndefined();
    expect(items[0].icon).toBeDefined();
    expect(items[0].tooltip).toBe("Title only");

    dispose();
  });

  it("gives dropdown children both title and label from one title resolver", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const items = buildPluginDropdowns(
      [makeGroup("ai", [makeCommand("a"), makeCommand("b")])],
      editor,
      selectionCtx(view),
      t
    );

    const children = items[0].children as MenuItem[];
    expect(children.map((child) => child.title)).toEqual(["Title a", "Title b"]);
    for (const child of children) {
      expect(child.title).toBe(child.label);
      expect(child.name).toBe("noop");
    }

    dispose();
  });

  it("skips plugins with no visible commands", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const hidden = makeCommand("hidden");
    hidden.visible = () => false;

    const items = buildPluginDropdowns(
      [makeGroup("ai", [hidden])],
      editor,
      selectionCtx(view),
      t
    );

    expect(items).toHaveLength(0);

    dispose();
  });

  it("applies the permissive default visible: empty selection contributes nothing", () => {
    const { editor, view, dispose } = createEditorMock();
    const items = buildPluginDropdowns(
      [makeGroup("ai", [makeCommand("a"), makeCommand("b")])],
      editor,
      selectionCtx(view),
      t
    );

    expect(items).toHaveLength(0);

    dispose();
  });

  it("applies the permissive default visible: read-only contributes nothing", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const items = buildPluginDropdowns(
      [makeGroup("ai", [makeCommand("a"), makeCommand("b")])],
      editor,
      selectionCtx(view, { readOnly: true }),
      t
    );

    expect(items).toHaveLength(0);

    dispose();
  });

  it("warns and skips a plugin whose icon cannot be resolved", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {});

    const items = buildPluginDropdowns(
      [{ ...makeGroup("ai", [makeCommand("a")]), icon: undefined }],
      editor,
      selectionCtx(view),
      t
    );

    expect(items).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    dispose();
  });

  it("clicking a dropdown child invokes run with a fully populated context", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const run = vi.fn((ctx: EditorCommandContext) => {
      expect(ctx.selectedText).toBe("world");
      expect(ctx.documentId).toBe("doc-1");
      expect(ctx.textBefore(500)).toContain("hello");
      ctx.replace("RAN");
      ctx.release();
    });
    const command = makeCommand("a", "selection", run);

    const items = buildPluginDropdowns(
      [makeGroup("ai", [command, makeCommand("b")])],
      editor,
      selectionCtx(view),
      t
    );

    const children = items[0].children as MenuItem[];
    children[0].onClick?.();

    expect(run).toHaveBeenCalledTimes(1);
    expect(docText(view.state)).toBe("hello RAN\nsecond paragraph");

    dispose();
  });

  it("releases the tracked range when run throws and still surfaces a toast", () => {
    const { editor, view, dispose } = createEditorMock(
      select(createState(), 7, 12)
    );
    const boom = new Error("boom");
    const run = vi.fn(() => {
      throw boom;
    });
    const errorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});

    const items = buildPluginDropdowns(
      [makeGroup("ai", [makeCommand("a", "selection", run)])],
      editor,
      selectionCtx(view),
      t
    );

    expect(() => {
      (items[0] as NonNullable<typeof items[0]>).onClick?.();
    }).not.toThrow();

    expect(run).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Plugin command"),
      boom
    );

    errorSpy.mockRestore();
    dispose();
  });
});

describe("buildPluginBlockItems", () => {
  it("builds flat sectioned items with title, label and keywords", () => {
    const { editor, dispose } = createEditorMock();
    const command = makeCommand("callout", "block");
    command.keywords = "fixture callout";

    const items = buildPluginBlockItems([makeGroup("ai", [command])], editor, t);

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("noop");
    expect(items[0].title).toBe("Title callout");
    expect(items[0].label).toBe("Title callout");
    expect(items[0].keywords).toBe("fixture callout");
    expect(items[0].section?.({ t })).toBe("Plugin ai");

    dispose();
  });

  it("clicking a block item invokes run at the current caret", () => {
    const { editor, view, dispose } = createEditorMock(select(createState(), 3, 3));
    const run = vi.fn((ctx: EditorCommandContext) => {
      ctx.replace("INSERTED");
      ctx.release();
    });
    const command = makeCommand("callout", "block", run);

    const items = buildPluginBlockItems([makeGroup("ai", [command])], editor, t);

    items[0].onClick?.();
    expect(run).toHaveBeenCalledTimes(1);
    expect(docText(view.state)).toContain("INSERTED");

    dispose();
  });

  it("skips block commands when the editor is read-only", () => {
    const { editor, dispose } = createEditorMock(createState(), {
      readOnly: true,
    });
    const items = buildPluginBlockItems(
      [makeGroup("ai", [makeCommand("callout", "block")])],
      editor,
      t
    );

    expect(items).toHaveLength(0);

    dispose();
  });
});
