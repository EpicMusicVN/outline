import * as React from "react";
import type { EditorCommand, EditorCommandGroup } from "~/editor/menus/pluginCommandTypes";
import { useComputed } from "~/hooks/useComputed";
import { Hook, PluginManager } from "~/utils/PluginManager";

/**
 * The commands contributed by a single plugin for one group, grouped for
 * rendering as one collapsed toolbar dropdown (selection) or one `/`-menu
 * section header (block).
 */
export interface PluginCommandGroup {
  /** The plugin id, used to namespace menu item keys. */
  pluginId: string;
  /** The plugin display name, used as the toolbar tooltip and `/`-menu section. */
  pluginName: string;
  /**
   * The plugin icon: the plugin's `Hook.Icon` value, else the first command's
   * `icon`, else undefined. Rendering the undefined case is the menu builder's
   * problem.
   */
  icon: React.ReactNode | undefined;
  /** The commands of the requested group, in plugin-registration order. */
  commands: EditorCommand[];
}

/**
 * Returns the plugin editor commands of a group, grouped by plugin and sorted
 * by plugin priority. Reads the observable plugin registry through `useComputed`
 * so late plugin registration is picked up on re-render.
 *
 * @param group The command group to return.
 * @returns The command groups, one per contributing plugin.
 */
export function useEditorCommands(group: EditorCommandGroup): PluginCommandGroup[] {
  return useComputed(() => {
    const groups: PluginCommandGroup[] = [];

    for (const plugin of PluginManager.getHooks(Hook.EditorCommand)) {
      const commands = plugin.value.filter((command) => command.group === group);
      if (commands.length === 0) {
        continue;
      }

      const iconType = PluginManager.getHook(Hook.Icon, plugin.id)?.value;
      const icon = iconType ? React.createElement(iconType) : commands[0].icon;

      groups.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        icon,
        commands,
      });
    }

    return groups;
  });
}
