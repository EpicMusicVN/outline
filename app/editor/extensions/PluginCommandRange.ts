import Extension from "@shared/editor/lib/Extension";
import { PluginCommandRangePlugin } from "../plugins/PluginCommandRangePlugin";

/**
 * Registers the plugin-command range tracker with every editor surface that
 * uses the client UI extensions. The plugin contributes state only, so it adds
 * no observable behaviour when no command is running.
 */
export default class PluginCommandRange extends Extension {
  get name() {
    return "plugin-command-range";
  }

  get plugins() {
    return [new PluginCommandRangePlugin()];
  }
}
