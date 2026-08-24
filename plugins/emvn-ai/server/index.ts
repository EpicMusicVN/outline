import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/emvnAi";
import env from "./env";
import { listPublicTargets } from "./targets";

const enabled = env.EMVN_AI_ENABLED && listPublicTargets().length > 0;

if (enabled) {
  PluginManager.add([
    {
      ...config,
      type: Hook.API,
      value: router,
    },
  ]);
}
