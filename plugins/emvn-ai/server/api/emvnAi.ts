import { randomUUID } from "node:crypto";
import httpErrors from "http-errors";
import Router from "koa-router";
import { UserRole } from "@shared/types";
import { toError } from "@shared/utils/error";
import { InvalidRequestError } from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import timeout from "@server/middlewares/timeout";
import validate from "@server/middlewares/validate";
import { Document } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { AICommandMetadataMap } from "../../shared/commands";
import type { AIStreamEvent } from "../../shared/types";
import { getAIBackend } from "../ai/AIBackend";
import { buildPrompt } from "../ai/prompts";
import { encodeEvent, HEARTBEAT, writeHead } from "../sse";
import { resolveTarget } from "../targets";
import * as T from "./schema";

const HEARTBEAT_INTERVAL_MS = 15_000;

const router = new Router();

router.post(
  "emvnAi.command",
  auth({ role: UserRole.Member }),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  timeout(120_000),
  validate(T.CommandSchema),
  async (ctx: APIContext<T.CommandReq>) => {
    const { user } = ctx.state.auth;
    const { commandId, text, documentId, targetId, language } = ctx.input.body;

    // Everything in this block can still fail with a normal HTTP status —
    // `ctx.respond = false` below is the point of no return.
    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });

    authorize(user, "read", document);

    const metadata = AICommandMetadataMap[commandId];
    if (metadata.resultMode === "replace") {
      // A read-only collaborator must not be offered a rewrite they cannot apply.
      authorize(user, "update", document);
    }

    const resolution = resolveTarget(targetId);
    if (!resolution.found) {
      // Never name the configured targets in the response.
      throw InvalidRequestError("Unknown target");
    }

    const prompt = buildPrompt(commandId, { text, language });
    const controller = new AbortController();
    const requestId = randomUUID();
    const logContext = { requestId, targetId: resolution.target.id };

    // The mint HTTP call and the WS connect happen on this first pull, so a
    // failure here becomes a clean JSON 502 instead of a truncated SSE
    // stream. Buffer the event and re-emit it once headers are out.
    const stream = getAIBackend().stream(
      { prompt, target: resolution.target, requestId },
      { signal: controller.signal }
    );
    const iterator = stream[Symbol.asyncIterator]();

    let firstResult: IteratorResult<AIStreamEvent>;
    try {
      firstResult = await iterator.next();
    } catch (err) {
      Logger.error(
        "emvnAi.command: failed to start AI stream",
        toError(err),
        logContext,
        ctx.req
      );
      throw httpErrors(502, "The AI service is currently unavailable", {
        id: "ai_service_unavailable",
        isReportable: true,
      });
    }

    // Header boundary — nothing past this point may throw. Failures become
    // SSE `error` events instead. `ctx.res` (not `ctx.req`) fires `close` on
    // a premature client disconnect here: the request body is already fully
    // consumed by this point, so the request stream's own `close` no longer
    // reflects the underlying connection's lifecycle.
    ctx.res.on("close", () => controller.abort());
    ctx.respond = false;
    writeHead(ctx.res);

    if (!firstResult.done) {
      ctx.res.write(encodeEvent(firstResult.value));
    }

    const heartbeat = setInterval(() => {
      ctx.res.write(HEARTBEAT);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of stream) {
        ctx.res.write(encodeEvent(event));
      }
    } catch (err) {
      Logger.error(
        "emvnAi.command: AI stream failed",
        toError(err),
        logContext,
        ctx.req
      );
      ctx.res.write(
        encodeEvent({
          type: "error",
          message: "Something went wrong while generating a response.",
        })
      );
    } finally {
      clearInterval(heartbeat);
      ctx.res.end();
      // Idempotent; also covers the success path so the backend's own
      // `finally` closes the socket.
      controller.abort();
    }
  }
);

export default router;
