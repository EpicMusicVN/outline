import type { IObservableArray } from "mobx";
import * as React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import type { EditorCommand, EditorCommandGroup } from "~/editor/menus/pluginCommandTypes";
import { Hook, PluginManager } from "~/utils/PluginManager";
import type { Plugin } from "~/utils/PluginManager";
import { useEditorCommands } from "./useEditorCommands";

const internals = PluginManager as unknown as {
  plugins: Map<Hook, IObservableArray<Plugin<Hook>>>;
};

function renderHook<T>(useHook: () => T) {
  const result: { current: T } = { current: undefined as T };
  const Component = () => {
    result.current = useHook();
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(React.createElement(Component), container);
  });

  return {
    result,
    rerender() {
      act(() => {
        ReactDOM.render(React.createElement(Component), container);
      });
    },
    unmount() {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      document.body.removeChild(container);
    },
  };
}

function makeCommand(id: string, group: EditorCommandGroup): EditorCommand {
  return {
    id,
    title: () => `Title ${id}`,
    group,
    icon: `icon-${id}`,
    run: vi.fn(),
  };
}

function TestIcon() {
  return null;
}

function register(
  id: string,
  commands: EditorCommand[],
  priority = 0,
  icon?: React.ElementType
) {
  PluginManager.add({
    id,
    name: `Plugin ${id}`,
    type: Hook.EditorCommand,
    value: commands,
    priority,
  });
  if (icon) {
    PluginManager.add({
      id,
      name: `Plugin ${id}`,
      type: Hook.Icon,
      value: icon,
    });
  }
}

beforeEach(() => {
  internals.plugins.clear();
});

describe("useEditorCommands", () => {
  it("returns an empty list when no plugins are registered", () => {
    const { result, unmount } = renderHook(() =>
      useEditorCommands("selection")
    );
    expect(result.current).toEqual([]);
    unmount();
  });

  it("filters commands by group", () => {
    register("ai", [
      makeCommand("a", "selection"),
      makeCommand("b", "block"),
    ]);

    const { result, unmount } = renderHook(() =>
      useEditorCommands("selection")
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].commands.map((c) => c.id)).toEqual(["a"]);
    unmount();
  });

  it("sorts plugins by priority and groups commands per plugin", () => {
    register("late", [makeCommand("x", "selection")], 10);
    register(
      "early",
      [makeCommand("y", "selection"), makeCommand("z", "selection")],
      5
    );

    const { result, unmount } = renderHook(() =>
      useEditorCommands("selection")
    );

    expect(result.current.map((g) => g.pluginId)).toEqual(["early", "late"]);
    expect(result.current[0].pluginName).toBe("Plugin early");
    expect(result.current[0].commands).toHaveLength(2);
    unmount();
  });

  it("resolves the plugin icon from Hook.Icon before the command icon", () => {
    register("ai", [makeCommand("a", "selection")], 0, TestIcon);

    const { result, unmount } = renderHook(() =>
      useEditorCommands("selection")
    );
    expect(result.current[0].icon).not.toBe("icon-a");
    expect(result.current[0].icon).not.toBeUndefined();
    unmount();
  });

  it("falls back to the first command icon when no Hook.Icon is registered", () => {
    register("ai", [makeCommand("a", "selection")]);

    const { result, unmount } = renderHook(() =>
      useEditorCommands("selection")
    );
    expect(result.current[0].icon).toBe("icon-a");
    unmount();
  });

  it("sees a plugin registered after the first read", () => {
    const hook = renderHook(() => useEditorCommands("selection"));
    expect(hook.result.current).toHaveLength(0);

    register("late", [makeCommand("a", "selection")]);
    hook.rerender();

    expect(hook.result.current).toHaveLength(1);
    expect(hook.result.current[0].pluginId).toBe("late");
    hook.unmount();
  });
});
