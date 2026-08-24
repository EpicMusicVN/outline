import type { EmbedDescriptor } from "@shared/editor/embeds";
import { useComputed } from "~/hooks/useComputed";
import { Hook, PluginManager } from "~/utils/PluginManager";

/**
 * Returns the embed descriptors contributed by plugins, in plugin-priority
 * order. Reads the observable plugin registry through `useComputed` so late
 * plugin registration is picked up on re-render.
 *
 * @returns The plugin embed descriptors.
 */
export function usePluginEmbeds(): EmbedDescriptor[] {
  return useComputed(() =>
    PluginManager.getHooks(Hook.EmbedDescriptor).flatMap(
      (plugin) => plugin.value
    )
  );
}

/**
 * Merge plugin embed descriptors into the built-in list. Plugin embeds are
 * inserted immediately before the generic iframe fallback (`id: "embed"`),
 * which must stay last. If upstream ever moves the fallback, plugin embeds are
 * appended instead so nothing is silently shadowed.
 *
 * @param base The built-in embed descriptors.
 * @param plugin The plugin embed descriptors.
 * @returns The merged list.
 */
export function mergePluginEmbeds(
  base: EmbedDescriptor[],
  plugin: EmbedDescriptor[]
): EmbedDescriptor[] {
  if (!plugin.length) {
    return base;
  }

  const last = base[base.length - 1];
  return last?.id === "embed"
    ? [...base.slice(0, -1), ...plugin, last]
    : [...base, ...plugin];
}
