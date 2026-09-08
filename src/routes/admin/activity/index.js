import { verifyAdminJWT } from "../../../middlewares/adminAuth";
import { ActivityLog } from "../../../controllers";
import { retentionDays } from "../../../utils/activityLog";
import { ListSchema, SummarySchema } from "./schema";

/**
 * Read-only admin API over the API/MCP call activity log
 * (src/utils/activityLog.js writes it; src/controllers/activityLog.js
 * stores it). Nothing here writes a row — the log only ever grows through
 * real traffic, and only ever shrinks through the retention sweep.
 */
export const adminActivityRoute = (fastify, opts, done) => {
  const guard = { preHandler: [verifyAdminJWT] };

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  // So the console can show "kept for 30 days" instead of a magic number.
  fastify.get("/config", guard, async (req, reply) =>
    reply.code(200).send({ success: true, data: { retention_days: retentionDays() } }),
  );

  fastify.get("/summary", { ...SummarySchema, ...guard }, async (req, reply) => {
    try {
      const data = await ActivityLog.Summary({
        envId: req.query.env_id,
        since: req.query.since,
      });
      return reply.code(200).send({ success: true, data });
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get("/", { ...ListSchema, ...guard }, async (req, reply) => {
    try {
      const { env_id, actor_email, surface, allowed, from, to, limit, offset } = req.query;

      const data = await ActivityLog.List({
        envId: env_id,
        actorEmail: actor_email,
        surface,
        allowed: allowed === undefined ? undefined : allowed === "true",
        from,
        to,
        limit,
        offset,
      });

      return reply.code(200).send({ success: true, data });
    } catch (err) {
      return fail(reply, err);
    }
  });

  done();
};
