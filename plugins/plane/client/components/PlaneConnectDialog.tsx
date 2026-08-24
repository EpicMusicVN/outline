import * as React from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import { IntegrationService } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";

// No OAuth redirect (D1): the API key is posted straight to plane.connect and
// stored encrypted server-side, so this is a plain credential form.
function PlaneConnectDialog() {
  const { t } = useTranslation();
  const { dialogs, integrations } = useStores();
  const [baseUrl, setBaseUrl] = React.useState("");
  const [workspaceSlug, setWorkspaceSlug] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const handleConnect = React.useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      setSaving(true);
      try {
        await client.post("/plane.connect", {
          url: baseUrl.trim().replace(/\/+$/, ""),
          workspaceSlug: workspaceSlug.trim(),
          apiKey: apiKey.trim(),
        });
        await integrations.fetchAll({
          service: IntegrationService.Plane,
          withRelations: true,
        });
        dialogs.closeAllModals();
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setSaving(false);
      }
    },
    [baseUrl, workspaceSlug, apiKey, dialogs, integrations]
  );

  return (
    <form onSubmit={handleConnect}>
      <Flex column gap={12}>
        <Text as="p" type="secondary">
          <Trans>Enter the details of your self-hosted Plane instance.</Trans>
        </Text>
        <Input
          label={t("Base URL")}
          placeholder="https://plane.example.com"
          value={baseUrl}
          onChange={(ev) => setBaseUrl(ev.currentTarget.value)}
          pattern="https://.*"
          title={t("URL must start with https")}
          required
          autoFocus
        />
        <Input
          label={t("Workspace slug")}
          placeholder={t("Your Plane workspace slug")}
          value={workspaceSlug}
          onChange={(ev) => setWorkspaceSlug(ev.currentTarget.value)}
          required
        />
        <Input
          label={t("API key")}
          placeholder={t("Plane API key")}
          value={apiKey}
          onChange={(ev) => setApiKey(ev.currentTarget.value)}
          type="password"
          required
        />
        <Flex justify="flex-end" gap={8}>
          <Button
            type="submit"
            disabled={
              !baseUrl.trim() ||
              !workspaceSlug.trim() ||
              !apiKey.trim() ||
              saving
            }
          >
            {saving ? `${t("Connecting")}…` : t("Connect")}
          </Button>
        </Flex>
      </Flex>
    </form>
  );
}

export default PlaneConnectDialog;
