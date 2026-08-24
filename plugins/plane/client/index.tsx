import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./components/Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      icon: Icon,
      description:
        "Connect your self-hosted Plane instance to Outline to enable rich issue and project previews inside documents.",
      component: createLazyComponent(() => import("./Settings")),
      enabled: (team, user) => user.isAdmin,
    },
  },
]);
