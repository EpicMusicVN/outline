import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./components/Icon";
import { EmbedDescriptor } from "@shared/editor/embeds";
import { IntegrationService } from "@shared/types";
import PlaneEmbed from "./embeds/PlaneEmbed";

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

PluginManager.add([
  {
    ...config,
    type: Hook.EmbedDescriptor,
    value: [
      new EmbedDescriptor({
        id: "plane",
        name: IntegrationService.Plane,
        title: "Plane",
        icon: <Icon />,
        component: PlaneEmbed,
        hideToolbar: true,
      }),
    ],
  },
]);
