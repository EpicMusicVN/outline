import { EmbedDescriptor } from "@shared/editor/embeds";
import * as Popover from "@radix-ui/react-popover";
import * as React from "react";
import ReactDOM from "react-dom";
import type { EditorCommand, EditorCommandContext } from "~/editor/menus/pluginCommandTypes";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";

type IconProps = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  fill?: string;
};

function Icon({ size = 24, fill = "currentColor" }: IconProps) {
  return (
    <svg fill={fill} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
    </svg>
  );
}

/**
 * Mounts a Radix popover on the command's virtual anchor inside the editor
 * container. Proves `ctx.anchor` (Radix `virtualRef`) and `ctx.containerEl`
 * (portal target) work together.
 */
function openFixturePopover(ctx: EditorCommandContext, label: string) {
  const container = ctx.containerEl;
  if (!container) {
    return;
  }

  const mount = document.createElement("div");
  mount.style.position = "absolute";
  container.appendChild(mount);

  ReactDOM.render(
    <Popover.Root defaultOpen>
      <Popover.Anchor virtualRef={{ current: ctx.anchor }} />
      <Popover.Portal>
        <Popover.Content sideOffset={8}>Seam fixture: {label}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>,
    mount
  );

  return mount;
}

const rewriteCommand: EditorCommand = {
  id: "rewrite",
  title: (t) => "Rewrite selection",
  keywords: "rewrite ai",
  group: "selection",
  run: (ctx) => {
    const before = ctx.textBefore(500).slice(-48);
    const mount = openFixturePopover(
      ctx,
      `selected "${ctx.selectedText.slice(0, 24)}" doc ${ctx.documentId ?? "none"} before "…${before}"`
    );

    // Streaming-style command: the popover preview stays open, then a delayed
    // single replace lands at the (possibly moved) tracked range.
    window.setTimeout(() => {
      ctx.replace(ctx.selectedText.toUpperCase());
      ctx.release();
      if (mount && mount.parentElement) {
        ReactDOM.unmountComponentAtNode(mount);
        mount.parentElement.removeChild(mount);
      }
    }, 150);
  },
};

const summarizeCommand: EditorCommand = {
  id: "summarize",
  title: (t) => "Summarize selection",
  keywords: "summarize ai",
  group: "selection",
  run: (ctx) => {
    ctx.replace(`[summary: ${ctx.selectedText.slice(0, 40)}]`);
    ctx.release();
  },
};

const calloutCommand: EditorCommand = {
  id: "insert-callout",
  title: (t) => "Insert fixture callout",
  keywords: "fixture callout",
  group: "block",
  run: (ctx) => {
    ctx.replace("> Fixture callout inserted from a plugin command");
    ctx.release();
  },
};

const fixtureEmbed = new EmbedDescriptor({
  id: "seam-fixture",
  title: "Seam Fixture",
  keywords: "fixture",
  icon: <Icon />,
  regexMatch: [/^https:\/\/fixture\.example\.com\/(.+)$/],
  transformMatch: (matches) => `https://fixture.example.com/embed/${matches[1]}`,
});

PluginManager.add([
  {
    ...config,
    type: Hook.Icon,
    value: Icon,
  },
  {
    ...config,
    type: Hook.EditorCommand,
    value: [rewriteCommand, summarizeCommand, calloutCommand],
  },
  {
    ...config,
    type: Hook.EmbedDescriptor,
    value: [fixtureEmbed],
  },
]);
