import { EnvironmentAccess, WrikeCredentials } from "../../../controllers";
import { clientIp, evaluateAccess } from "../../../utils/environmentAccess";
import { EnvQuerySchema, CheckSchema } from "../../admin/environmentAccess/schema";
import {
  verifyPortalJWT,
  requirePasswordChanged,
  requirePortalPermission,
} from "../../../middlewares/portalAuth";

/**
 * Portal API over the environment-level API access allow list — the same
 * data src/routes/admin/environmentAccess/index.js exposes to the
 * super-admin console, gated here behind the "environment_access" portal-
 * permission module instead of verifyAdminJWT. Only the read actions the
 * portal's <EnvironmentAccess canWrite=false> view needs: list rules, the
 * rule-count summary, "what's my IP", and the check simulator. No
 * create/update/delete route — src/utils/portalPermissionCatalog.js governs
 * write access for a future pass; this route only ever grants "read", so
 * there is nothing to gate a write behind yet.
 *
 * Row-level scoping matches src/routes/portal/activity/index.js: a portal
 * user may only see rules (and the summary/check) for environments they own
 * (admin-role portal users are unrestricted, matching GetMyEnvironments).
 * Without this, environment_access:read would let a portal user read (and
 * simulate against) another tenant's allow list just by passing a different
 * env_id.
 */
export const portalEnvironmentAccessRoute = (fastify, opts, done) => {
  const guard = {
    preHandler: [
      verifyPortalJWT,
      requirePasswordChanged,
      requirePortalPermission("environment_access", "read"),
    ],
  };

  const ok = (reply, data, message) => reply.code(200).send({ success: true, message, data });

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  /** True if this portal user may see envId — admin-role portal users see
      every environment, matching GetMyEnvironments' own admin bypass. */
  const ownsEnv = async (portalUser, envId) => {
    if (!envId) return false;
    if (portalUser.role === "admin") return true;

    const owned = await WrikeCredentials.GetByOwnerId(portalUser.id);
    return (owned || []).some((env) => env.id === envId);
  };

  fastify.get("/my-ip", guard, async (req, reply) => ok(reply, { ip: clientIp(req) }));

  fastify.get("/rules", { ...EnvQuerySchema, ...guard }, async (req, reply) => {
    try {
      if (!(await ownsEnv(req.portalUser, req.query.env_id))) {
        return reply.code(403).send({
          success: false,
          message: "You do not have access to this environment.",
        });
      }
      return ok(reply, await EnvironmentAccess.GetRulesByEnv(req.query.env_id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post("/check", { ...CheckSchema, ...guard }, async (req, reply) => {
    try {
      const { env_id, email, ip, surface } = req.body;

      if (!(await ownsEnv(req.portalUser, env_id))) {
        return reply.code(403).send({
          success: false,
          message: "You do not have access to this environment.",
        });
      }

      if (!email && !ip) {
        throw { statusCode: 400, message: "Provide an email, an IP, or both to check." };
      }

      const result = await evaluateAccess({
        envId: env_id,
        email,
        ip,
        surface: surface || undefined,
      });
      return ok(reply, result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  done();
};

export default portalEnvironmentAccessRoute;
