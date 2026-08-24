import type { IObservableArray } from "mobx";
import * as React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import embeds, { EmbedDescriptor } from "@shared/editor/embeds";
import { Hook, PluginManager } from "~/utils/PluginManager";
import type { Plugin } from "~/utils/PluginManager";
import useEmbeds from "./useEmbeds";
import { mergePluginEmbeds } from "./usePluginEmbeds";

const { integrationsMock, teamMock } = vi.hoisted(() => ({
  integrationsMock: {
    orderedData: [] as Array<{ service: string; settings?: unknown }>,
    isLoaded: true,
    isFetching: false,
    fetchAll: vi.fn(),
  },
  teamMock: {
    getPreference: vi.fn((): string[] => []),
    preferences: null,
  },
}));

vi.mock("~/hooks/useStores", () => ({
  default: () => ({ integrations: integrationsMock }),
}));

vi.mock("~/hooks/useCurrentTeam", () => ({
  default: () => teamMock,
}));

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
    unmount: () => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      document.body.removeChild(container);
    },
  };
}

function fixtureEmbed() {
  return new EmbedDescriptor({
    id: "seam-fixture",
    title: "Seam Fixture",
    name: "seam-fixture",
    regexMatch: [/^https:\/\/fixture\.example\.com\/(.+)$/],
  });
}

function registerPluginEmbed(embed: EmbedDescriptor) {
  PluginManager.add({
    id: "seam-fixture",
    name: "Seam Fixture",
    type: Hook.EmbedDescriptor,
    value: [embed],
  });
}

beforeEach(() => {
  internals.plugins.clear();
  teamMock.getPreference.mockReturnValue([]);
  integrationsMock.orderedData = [];
});

describe("mergePluginEmbeds", () => {
  it("returns the base list unchanged when there are no plugin embeds", () => {
    expect(mergePluginEmbeds(embeds, [])).toBe(embeds);
  });

  it("inserts plugin embeds immediately before the generic fallback", () => {
    const merged = mergePluginEmbeds(embeds, [fixtureEmbed()]);
    expect(merged[merged.length - 1].id).toBe("embed");
    expect(merged[merged.length - 2].id).toBe("seam-fixture");
  });

  it("appends plugin embeds when the fallback is not last, shadowing nothing", () => {
    const base = [
      new EmbedDescriptor({ id: "x", title: "X" }),
      new EmbedDescriptor({ id: "y", title: "Y" }),
    ];
    const merged = mergePluginEmbeds(base, [fixtureEmbed()]);
    expect(merged.map((e) => e.id)).toEqual(["x", "y", "seam-fixture"]);
  });
});

describe("useEmbeds", () => {
  it("returns the built-in embeds in order when no plugins are registered", () => {
    const { result, unmount } = renderHook(() => useEmbeds());
    expect(result.current.map((e) => e.id)).toEqual(embeds.map((e) => e.id));
    unmount();
  });

  it("places a plugin embed before the generic fallback", () => {
    registerPluginEmbed(fixtureEmbed());

    const { result, unmount } = renderHook(() => useEmbeds());
    const ids = result.current.map((e) => e.id);
    expect(ids[ids.length - 1]).toBe("embed");
    expect(ids[ids.length - 2]).toBe("seam-fixture");
    unmount();
  });

  it("marks a plugin embed disabled when the team disables it", () => {
    teamMock.getPreference.mockReturnValue(["seam-fixture"]);
    registerPluginEmbed(fixtureEmbed());

    const { result, unmount } = renderHook(() => useEmbeds());
    const pluginEmbed = result.current.find((e) => e.id === "seam-fixture");
    expect(pluginEmbed?.disabled).toBe(true);
    unmount();
  });

  it("injects integration settings into a matching plugin embed", () => {
    integrationsMock.orderedData = [
      { service: "seam-fixture", settings: { url: "https://fixture.example.com" } },
    ];
    registerPluginEmbed(fixtureEmbed());

    const { result, unmount } = renderHook(() => useEmbeds());
    const pluginEmbed = result.current.find((e) => e.id === "seam-fixture");
    expect(pluginEmbed?.settings).toEqual({
      url: "https://fixture.example.com",
    });
    unmount();
  });
});
