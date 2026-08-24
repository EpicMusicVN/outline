import * as React from "react";
import { CSRF } from "@shared/constants";
import { getCSRFToken } from "~/utils/csrf";
import type { PlaneInfoResponse } from "../../shared/types";

/** Fetch state for a single `POST /api/plane.info` lookup. */
export type PlaneInfoState =
  | { status: "loading" }
  | { status: "loaded"; data: PlaneInfoResponse }
  | { status: "not_found" }
  | { status: "error"; error: Error };

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string;
      error?: string;
    };
    return (
      body.message ??
      body.error ??
      `Plane request failed with status ${response.status}`
    );
  } catch {
    return `Plane request failed with status ${response.status}`;
  }
}

/**
 * Fetches issue/board data for a Plane URL from `POST /api/plane.info`. The
 * embed renders inside a ProseMirror node view rather than a mobx-store
 * consumer, so it talks to the API directly with `fetch` instead of the
 * store-oriented `~/utils/ApiClient`, attaching the CSRF header by hand.
 *
 * @param url The Plane issue or project URL embedded in the document.
 * @returns The current fetch state.
 */
export function usePlaneInfo(url: string): PlaneInfoState {
  const [state, setState] = React.useState<PlaneInfoState>({
    status: "loading",
  });

  React.useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch("/api/plane.info", {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            [CSRF.headerName]: getCSRFToken(),
          },
          body: JSON.stringify({ url }),
        });
        if (controller.signal.aborted) {
          return;
        }

        if (response.status === 204) {
          setState({ status: "not_found" });
          return;
        }

        if (!response.ok) {
          const message = await readErrorMessage(response);
          if (!controller.signal.aborted) {
            setState({ status: "error", error: new Error(message) });
          }
          return;
        }

        const { data } = (await response.json()) as {
          data: PlaneInfoResponse;
        };
        if (!controller.signal.aborted) {
          setState({ status: "loaded", data });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    })();

    return () => controller.abort();
  }, [url]);

  return state;
}
