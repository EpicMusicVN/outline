import copy from "copy-to-clipboard";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CSRF } from "@shared/constants";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import { useDocumentContext } from "~/components/DocumentContext";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Modal from "~/components/Modal";
import { getCSRFToken } from "~/utils/csrf";

type Props = {
  /** The Plane project the issue will be created in */
  projectId: string;
  /**
   * Called with the created issue's web URL after a successful submit. The
   * embed seam (`EmbedProps`) has no document-mutation hook, so insertion
   * into the document is the caller's responsibility — see PlaneBoard.tsx.
   * When omitted, the URL is copied to the clipboard instead so a user can
   * paste it manually and have it render through the existing unfurl path.
   */
  onIssueCreated?: (url: string) => void;
  /** Called when the dialog should close, whether cancelled or submitted */
  onRequestClose: () => void;
};

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string;
      error?: string;
    };
    return (
      body.message ??
      body.error ??
      `Request failed with status ${response.status}`
    );
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

/**
 * A minimal title/description form that creates a Plane issue via
 * `POST /api/plane.createIssue`. Rendered inside a ProseMirror node view
 * (see usePlaneInfo.ts's comment), so it talks to the API directly with
 * `fetch` rather than the store-oriented `~/utils/ApiClient`, attaching the
 * CSRF header by hand.
 */
function PlaneCreateIssueDialog({
  projectId,
  onIssueCreated,
  onRequestClose,
}: Props) {
  const { t } = useTranslation();
  const { document } = useDocumentContext();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      if (!document || !title.trim()) {
        return;
      }

      setSubmitting(true);
      try {
        const response = await fetch("/api/plane.createIssue", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            [CSRF.headerName]: getCSRFToken(),
          },
          body: JSON.stringify({
            documentId: document.id,
            projectId,
            title: title.trim(),
            description: description.trim() || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        const { data } = (await response.json()) as { data: { url: string } };

        if (onIssueCreated) {
          onIssueCreated(data.url);
        } else {
          copy(data.url);
          toast.success(
            t("Issue created. The link was copied — paste it into the document.")
          );
        }
        onRequestClose();
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setSubmitting(false);
      }
    },
    [document, projectId, title, description, onIssueCreated, onRequestClose, t]
  );

  return (
    <Modal isOpen title={t("New issue")} onRequestClose={onRequestClose}>
      <form onSubmit={handleSubmit}>
        <Flex column gap={12}>
          <Input
            label={t("Title")}
            value={title}
            onChange={(ev) => setTitle(ev.currentTarget.value)}
            maxLength={255}
            required
            autoFocus
          />
          <Input
            label={t("Description")}
            type="textarea"
            value={description}
            onChange={(ev) => setDescription(ev.currentTarget.value)}
            rows={4}
          />
          <Flex justify="flex-end" gap={8}>
            <Button neutral type="button" onClick={onRequestClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || submitting}>
              {submitting ? `${t("Creating")}…` : t("Create issue")}
            </Button>
          </Flex>
        </Flex>
      </form>
    </Modal>
  );
}

export default PlaneCreateIssueDialog;
