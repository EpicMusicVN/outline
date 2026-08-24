import { randomUUID } from "node:crypto";
// oxlint-disable-next-line no-restricted-imports
import type { Response } from "node-fetch";
import { CollectionPermission } from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { AICommandId } from "../../shared/commands";
import type { AIStreamEvent } from "../../shared/types";
import type { AIBackend, AIRequest } from "../ai/AIBackend";
import * as AIBackendModule from "../ai/AIBackend";

const server = getTestServer();

const TARGET_ID = "test-target";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockBackend(
  streamImpl: (
    request: AIRequest,
    options: { signal: AbortSignal }
  ) => AsyncIterable<AIStreamEvent>
) {
  const stream = vi.fn(streamImpl);
  const backend: AIBackend = { stream };
  // The plugin router is eager-loaded once at global test setup, before this
  // file's module graph exists, so it holds a live binding to the real
  // `getAIBackend` export — `vi.mock` cannot retroactively rewrite that
  // binding. Patching the shared module namespace object in place (the same
  // pattern `plugins/slack/server/api/hooks.test.ts` uses for `Slack.post`)
  // reaches every existing reference to the export.
  vi.spyOn(AIBackendModule, "getAIBackend").mockReturnValue(backend);
  return stream;
}

async function buildDocumentAndUser(
  overrides: { permission?: CollectionPermission } = {}
) {
  const team = await buildTeam();
  const owner = await buildUser({ teamId: team.id });
  const collection = await buildCollection({
    teamId: team.id,
    userId: owner.id,
    permission: overrides.permission ?? CollectionPermission.ReadWrite,
  });
  const document = await buildDocument({
    teamId: team.id,
    userId: owner.id,
    collectionId: collection.id,
  });
  return { team, owner, collection, document };
}

function commandBody(overrides: Record<string, unknown> = {}) {
  return {
    commandId: AICommandId.Summarize,
    text: "Some sample selection text.",
    documentId: randomUUID(),
    targetId: TARGET_ID,
    ...overrides,
  };
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as AIStreamEvent);
}

describe("#emvnAi.command", () => {
  it("fails with 401 when the user is unauthenticated", async () => {
    const res = await server.post("/api/emvnAi.command", {
      body: commandBody(),
    });
    const body = await res.json();

    expect(res.status).toEqual(401);
    expect(body.message).toEqual("Authentication required");
  });

  it("fails with 400 for an unknown commandId", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ commandId: "nope", documentId: document.id }),
    });

    expect(res.status).toEqual(400);
  });

  it("fails with 400 when text exceeds the maximum length", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({
        text: "a".repeat(8001),
        documentId: document.id,
      }),
    });

    expect(res.status).toEqual(400);
  });

  it("fails with 400 when the translate command is missing a language", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({
        commandId: AICommandId.Translate,
        documentId: document.id,
      }),
    });

    expect(res.status).toEqual(400);
  });

  it("fails with 400 when the translate language is not configured", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({
        commandId: AICommandId.Translate,
        language: "klingon",
        documentId: document.id,
      }),
    });

    expect(res.status).toEqual(400);
  });

  it("fails with 400 for an unknown targetId, without naming configured targets", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({
        targetId: "does-not-exist",
        documentId: document.id,
      }),
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).not.toContain(TARGET_ID);
    expect(body.message).not.toContain("Test Target");
  });

  it("fails with 403 for a document belonging to another team", async () => {
    const { document } = await buildDocumentAndUser();
    const outsider = await buildUser();
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", outsider, {
      body: commandBody({ documentId: document.id }),
    });

    expect(res.status).toEqual(403);
  });

  it("fails with 403 for a read-only collaborator running a replace command", async () => {
    const { team, document } = await buildDocumentAndUser({
      permission: CollectionPermission.Read,
    });
    const collaborator = await buildUser({ teamId: team.id });
    mockBackend(async function* () {});

    const res = await server.post("/api/emvnAi.command", collaborator, {
      body: commandBody({
        commandId: AICommandId.Rewrite,
        documentId: document.id,
      }),
    });

    expect(res.status).toEqual(403);
  });

  it("returns a 502 JSON error, no SSE headers, when the backend fails before yielding", async () => {
    const { owner, document } = await buildDocumentAndUser();
    // oxlint-disable-next-line require-yield
    mockBackend(async function* () {
      throw new Error("mint failed: agent hub unreachable");
    });

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
    });

    expect(res.status).toEqual(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-accel-buffering")).toBeNull();

    const body = await res.json();
    expect(body.message).not.toContain("mint failed");
  });

  it("streams ordered SSE frames, forwarding thoughts verbatim, ending with done", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {
      yield { type: "delta", text: "Hello" };
      yield { type: "thought", text: "considering tone" };
      yield { type: "delta", text: " world" };
      yield { type: "done", stopReason: "end_turn" };
    });

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
    });

    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toEqual("no");
    expect(res.headers.get("cache-control")).toContain("no-transform");

    const events = await readEvents(res);
    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "thought", text: "considering tone" },
      { type: "delta", text: " world" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("forwards a backend-yielded error event as the final SSE frame, not a 500", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {
      yield { type: "delta", text: "partial" };
      yield { type: "error", message: "agent connection dropped" };
    });

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
    });

    expect(res.status).toEqual(200);
    const events = await readEvents(res);
    expect(events).toEqual([
      { type: "delta", text: "partial" },
      { type: "error", message: "agent connection dropped" },
    ]);
  });

  it("converts a mid-stream throw into a generic SSE error frame, not a 500", async () => {
    const { owner, document } = await buildDocumentAndUser();
    mockBackend(async function* () {
      yield { type: "delta", text: "partial" };
      throw new Error("socket closed unexpectedly");
    });

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
    });

    expect(res.status).toEqual(200);
    const events = await readEvents(res);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "delta", text: "partial" });
    const errorEvent = events[1];
    expect(errorEvent.type).toEqual("error");
    if (errorEvent.type === "error") {
      expect(errorEvent.message).not.toContain("socket closed unexpectedly");
    }
  });

  it("propagates a client abort to the backend's AbortSignal", async () => {
    const { owner, document } = await buildDocumentAndUser();
    let resolveSawAbort: (aborted: boolean) => void;
    const sawAbort = new Promise<boolean>((resolve) => {
      resolveSawAbort = resolve;
    });

    mockBackend(async function* (_request, options) {
      yield { type: "delta", text: "start" };
      await new Promise<void>((resolve) => {
        options.signal.addEventListener("abort", () => {
          resolveSawAbort(options.signal.aborted);
          resolve();
        });
      });
    });

    const controller = new AbortController();
    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
      signal: controller.signal,
    });

    expect(res.status).toEqual(200);
    controller.abort();

    await expect(sawAbort).resolves.toBe(true);
  });

  it("passes the resolved target through to the backend", async () => {
    const { owner, document } = await buildDocumentAndUser();
    const stream = mockBackend(async function* () {
      yield { type: "done", stopReason: "end_turn" };
    });

    const res = await server.post("/api/emvnAi.command", owner, {
      body: commandBody({ documentId: document.id }),
    });
    await res.text();

    expect(stream).toHaveBeenCalledTimes(1);
    const [request] = stream.mock.calls[0];
    expect(request.target).toEqual({
      id: TARGET_ID,
      label: "Test Target",
      instanceId: "test-instance",
    });
  });
});
