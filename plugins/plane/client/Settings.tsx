import { observer } from "mobx-react";
import { PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation, Trans } from "react-i18next";
import { IntegrationService } from "@shared/types";
import { ConnectedButton } from "~/scenes/Settings/components/ConnectedButton";
import { IntegrationScene } from "~/scenes/Settings/components/IntegrationScene";
import Button, { type Props } from "~/components/Button";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import List from "~/components/List";
import ListItem from "~/components/List/Item";
import Notice from "~/components/Notice";
import PlaceholderText from "~/components/PlaceholderText";
import Text from "~/components/Text";
import Time from "~/components/Time";
import env from "~/env";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { BadGatewayError } from "~/utils/errors";
import PlaneIcon from "./components/Icon";
import PlaneConnectDialog from "./components/PlaneConnectDialog";

function PlaneConnectButton(props: Props<HTMLButtonElement>) {
  const { t } = useTranslation();
  const { dialogs } = useStores();

  const handleClick = () => {
    dialogs.openModal({
      title: t("Connect Plane"),
      content: <PlaneConnectDialog />,
    });
  };

  return (
    <Button onClick={handleClick} neutral {...props}>
      {t("Connect")}
    </Button>
  );
}

function Plane() {
  const { integrations } = useStores();
  const { t } = useTranslation();
  const appName = env.APP_NAME;
  const planeIntegration = integrations.plane[0];
  const settings = planeIntegration?.settings.plane;
  const baseUrl = settings?.url;
  const workspaceSlug = settings?.workspaceSlug;
  const integrationCreatedBy = planeIntegration?.user
    ? planeIntegration.user.name
    : undefined;
  const connectionUpdatedAt = planeIntegration?.updatedAt;
  const [reconnectRequired, setReconnectRequired] = React.useState(false);

  React.useEffect(() => {
    void integrations.fetchAll({
      service: IntegrationService.Plane,
      withRelations: true,
    });
  }, [integrations]);

  // Probe the stored connection whenever it changes so a revoked or expired
  // key surfaces the reconnect notice (R9). plane.projects answers with a
  // 502 carrying the plane_reconnect_required code when the key is rejected;
  // the client short-circuits 502 before parsing the structured body, so the
  // code is matched from the BadGatewayError message.
  React.useEffect(() => {
    if (!connectionUpdatedAt) {
      setReconnectRequired(false);
      return;
    }

    let cancelled = false;
    void client
      .post("/plane.projects", {})
      .then(() => {
        if (!cancelled) {
          setReconnectRequired(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReconnectRequired(
            err instanceof BadGatewayError &&
              err.message.includes("plane_reconnect_required")
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectionUpdatedAt]);

  const handleDisconnect = React.useCallback(async () => {
    // plane.disconnect, not integrations.delete: the generic route soft-deletes
    // the row while plane.disconnect also destroys the encrypted token.
    await client.post("/plane.disconnect", {});
    integrations.removeAll(
      (integration) => integration.service === IntegrationService.Plane
    );
  }, [integrations]);

  return (
    <IntegrationScene title="Plane" icon={<PlaneIcon />}>
      <Heading>Plane</Heading>

      <Notice>
        <Trans>
          The Plane API key is shared with the entire team: any member who opens
          a Plane link will see the issue or project with the permissions
          granted to the key. Only connect a key whose access you intend
          everyone to share.
        </Trans>
      </Notice>

      {reconnectRequired && (
        <Notice>
          <Trans>
            Plane rejected the stored API key. Reconnect to restore issue and
            project previews.
          </Trans>
        </Notice>
      )}

      <Text as="p">
        <Trans>
          Enable previews of Plane issues and projects in documents by
          connecting a self-hosted Plane instance to {{ appName }}.
        </Trans>
      </Text>

      {planeIntegration ? (
        <>
          <Heading as="h2">
            <Flex justify="space-between" auto>
              {t("Connected")}
              <PlaneConnectButton icon={<PlusIcon />} />
            </Flex>
          </Heading>
          <List>
            <ListItem
              key={planeIntegration.id}
              small
              title={workspaceSlug}
              subtitle={
                integrationCreatedBy ? (
                  <>
                    {baseUrl} &middot;{" "}
                    <Trans>Enabled by {{ integrationCreatedBy }}</Trans>{" "}
                    &middot;{" "}
                    <Time
                      dateTime={planeIntegration.createdAt}
                      relative={false}
                      format={{ en_US: "MMMM d, y" }}
                    />
                  </>
                ) : (
                  <PlaceholderText />
                )
              }
              image={<PlaneIcon size={48} />}
              actions={
                <ConnectedButton
                  onClick={handleDisconnect}
                  confirmationMessage={t(
                    "Disconnecting will prevent previewing links from Plane in documents. Are you sure?"
                  )}
                />
              }
            />
          </List>
        </>
      ) : (
        <p>
          <PlaneConnectButton icon={<PlaneIcon />} />
        </p>
      )}
    </IntegrationScene>
  );
}

export default observer(Plane);
