import { Hook, PluginManager } from "~/utils/PluginManager";
import env from "~/env";
import Icon from "./Icon";
import { commands } from "./commands";
import config from "../plugin.json";

// Gated on the public flags so unconfigured installs show no commands. The
// server rejects `/api/emvnAi.command` regardless — this is UX, not a
// security control (the route isn't even registered without a full config,
// per plugins/emvn-ai/server/env.ts).
if (env.EMVN_AI_ENABLED && env.EMVN_AI_TARGET_OPTIONS?.length) {
  PluginManager.add([
    { ...config, type: Hook.EditorCommand, value: commands },
    { ...config, type: Hook.Icon, value: Icon },
  ]);
}
