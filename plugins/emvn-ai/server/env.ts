import { IsBoolean, IsOptional, IsUrl } from "class-validator";
import { Environment } from "@server/env";
import { Public } from "@server/utils/decorators/Public";
import environment from "@server/utils/environment";
import { CannotUseWithout } from "@server/utils/validators";
import { listPublicTargets } from "./targets";

class EmvnAiPluginEnvironment extends Environment {
  /**
   * Agent Hub API base URL used to mint short-lived ACP chat tokens.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ["http", "https"],
  })
  @CannotUseWithout("EMVN_AI_WS_URL")
  @CannotUseWithout("EMVN_AI_MINT_TOKEN")
  @CannotUseWithout("EMVN_AI_TARGETS")
  public EMVN_AI_API_URL = this.toOptionalString(environment.EMVN_AI_API_URL);

  /**
   * ws-bridge WebSocket base URL for the ACP chat connection.
   */
  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ["ws", "wss"],
  })
  @CannotUseWithout("EMVN_AI_API_URL")
  public EMVN_AI_WS_URL = this.toOptionalString(environment.EMVN_AI_WS_URL);

  /**
   * Default mint credential used by targets that do not carry their own token.
   */
  @IsOptional()
  @CannotUseWithout("EMVN_AI_API_URL")
  public EMVN_AI_MINT_TOKEN = this.toOptionalString(
    environment.EMVN_AI_MINT_TOKEN
  );

  /**
   * JSON registry of agent targets; parsed and validated by targets.ts.
   */
  @IsOptional()
  @CannotUseWithout("EMVN_AI_API_URL")
  public EMVN_AI_TARGETS = this.toOptionalString(environment.EMVN_AI_TARGETS);

  /**
   * Comma-separated language codes offered by the Translate command.
   */
  @Public
  @IsOptional()
  public EMVN_AI_TRANSLATE_LANGUAGES =
    this.toOptionalString(environment.EMVN_AI_TRANSLATE_LANGUAGES) ?? "en,vi";

  /**
   * Whether the plugin is fully configured. Declared last so every field it
   * reads is initialized.
   */
  @Public
  @IsBoolean()
  public EMVN_AI_ENABLED = Boolean(
    this.EMVN_AI_API_URL &&
      this.EMVN_AI_WS_URL &&
      this.EMVN_AI_MINT_TOKEN &&
      this.EMVN_AI_TARGETS
  );

  /**
   * Public projection of configured targets, sent to the browser.
   */
  @Public
  public EMVN_AI_TARGET_OPTIONS = listPublicTargets();
}

export default new EmvnAiPluginEnvironment();
