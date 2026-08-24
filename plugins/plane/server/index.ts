import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/plane";

// Plane is connect-driven like GitLab: credentials are supplied per team via
// the plane.connect flow, so no environment configuration is required and the
// API router is always registered.
PluginManager.add({
  ...config,
  type: Hook.API,
  value: router,
});
