import { verifyAdminJWT } from "../../../middlewares/adminAuth";
import { EnvironmentAccess } from "../../../controllers";
import {
  clientIp,
  evaluateAccess,
  invalidateEnvironment,
} from "../../../utils/environmentAccess";

import {
  CreateRuleSchema,
  UpdateRuleSchema,
  IdParamSchema,
  EnvQuerySchema,
  CheckSchema,
} from "./schema";

/**
 * Admin API behind /api/v1/admin/environment-access — the console's control
 * surface over the allow list the request-path gate reads
 * (src/utils/environmentAccess.js).
 *
 * Every write invalidates that environment's cached rule index before
 * replying, so a change takes effect on the very next API/MCP call rather
 * than up to a TTL later.
 */
export const adminEnvironmentAccessRoute = (fastify, opts, done) => {
  const guard = { preHandler: [verifyAdminJWT] };

  const ok = (reply, data, message) =>
    reply.code(200).send({ success: true, message, data });

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  // GET /environment-access/my-ip — the "Use my IP" button in the Add-entry
  // modal. Deliberately the exact same clientIp() the request-path gate
  // itself reads, so what this returns is guaranteed to be what an IP rule
  // built from it would actually match — not a separate "what's my IP"
  // lookup that could disagree with the real gate.
  fastify.get("/my-ip", guard, async (req, reply) => ok(reply, { ip: clientIp(req) }));

  fastify.get("/summary", guard, async (req, reply) => {
    try {
      return ok(reply, await EnvironmentAccess.GetSummary());
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get("/rules", { ...EnvQuerySchema, ...guard }, async (req, reply) => {
    try {
      return ok(reply, await EnvironmentAccess.GetRulesByEnv(req.query.env_id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post("/rules", { ...CreateRuleSchema, ...guard }, async (req, reply) => {
    try {
      const rule = await EnvironmentAccess.CreateRule(req.adminUser.id, req.body);
      await invalidateEnvironment(rule.env_id);

      return reply.code(201).send({
        success: true,
        message: "Allow-list entry added.",
        data: rule,
      });
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.put("/rules/:id", { ...UpdateRuleSchema, ...guard }, async (req, reply) => {
    try {
      const rule = await EnvironmentAccess.UpdateRule(req.adminUser.id, req.params.id, req.body);
      await invalidateEnvironment(rule.env_id);

      return ok(reply, rule, "Allow-list entry updated.");
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.delete("/rules/:id", { ...IdParamSchema, ...guard }, async (req, reply) => {
    try {
      const { env_id } = await EnvironmentAccess.DeleteRule(req.adminUser.id, req.params.id);
      await invalidateEnvironment(env_id);

      return ok(reply, null, "Allow-list entry removed.");
    } catch (err) {
      return fail(reply, err);
    }
  });

  // POST /environment-access/check — the simulator. Runs the exact same
  // evaluateAccess() the request path uses, with an admin-supplied email
  // and/or IP standing in for a live token.
  fastify.post("/check", { ...CheckSchema, ...guard }, async (req, reply) => {
    try {
      const { env_id, email, ip } = req.body;

      if (!email && !ip) {
        throw { statusCode: 400, message: "Provide an email, an IP, or both to check." };
      }

      const result = await evaluateAccess({ envId: env_id, email, ip });
      return ok(reply, result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  done();
};
