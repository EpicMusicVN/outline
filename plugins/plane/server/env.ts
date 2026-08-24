import { IsOptional } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class PlanePluginEnvironment extends Environment {
  /**
   * Optional default Plane base URL hint for the settings form. Credentials
   * are never configured via environment variables — the API key lives in
   * `IntegrationAuthentication.token`.
   */
  @IsOptional()
  public PLANE_DEFAULT_URL = this.toOptionalString(
    environment.PLANE_DEFAULT_URL
  );
}

export default new PlanePluginEnvironment();
