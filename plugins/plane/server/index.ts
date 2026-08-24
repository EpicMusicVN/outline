import { Minute } from "@shared/utils/time";
import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/plane";
import { Plane } from "./plane";

// Plane is connect-driven like GitLab: credentials are supplied per team via
// the plane.connect flow, so no environment configuration is required and the
// API router is always registered.
PluginManager.add({
  ...config,
  type: Hook.API,
  value: router,
});

// Link unfurling: Plane has no webhooks, so freshness comes from a short
// cache expiry on the unfurl result (D6).
PluginManager.add({
  ...config,
  type: Hook.UnfurlProvider,
  value: { unfurl: Plane.unfurl, cacheExpiry: Minute.seconds },
});
