import { EnvironmentAccess, WrikeCredentials } from "../../../controllers";
import { clientIp, evaluateAccess } from "../../../utils/environmentAccess";
import { syncWrikeCredentialsFromDB } from "../../../utils/wrikeCredentials";
import {
  EnvQuerySchema,
  CheckSchema,
  CreateRuleSchema,
  UpdateRuleSchema,
  IdParamSchema,
} from "../../admin/environmentAccess/schema";
import {
  verifyPortalJWT,
  requirePasswordChanged,
  requirePortalPermission,
} from "../../../middlewares/portalAuth";

/**
 * Portal API over the environment-level API access allow list — the same data
 * and the same controller calls src/routes/admin/environmentAccess/index.js
 * uses for the super-admin console, gated here behind the
 * "environment_access" portal-permission module instead of verifyAdminJWT.
 *
 * One action per route, so the catalogue's four grants map exactly onto what
 * a portal user can do (src/utils/portalPermissionCatalog.js):
 *
 *   read    GET   /my-ip · /rules · POST /check (the simulator)
 *   create  POST   /rules
 *   update  PUT    /rules/:id · PATCH /gates (the two security switches)
 *   delete  DELETE /rules/:id
 *
 * Row-level scoping matches src/routes/portal/activity/index.js: every route
 * — read or write — resolves the environment it touches and refuses unless
 * the caller owns it (admin-role portal users are unrestricted, matching
 * GetMyEnvironments). Without this a portal user could read, edit or delete
 * another tenant's allow list just by naming its env_id or rule id.
 *
 * Write routes pass null as the profile id: created_by/updated_by reference
 * admin_users, not portal_users, exactly as the portal's environment handlers
 * already do.
 */
export const portalEnvironmentAccessRoute = (fastify, opts, done) => {
  const authGuard = [verifyPortalJWT, requirePasswordChanged];

  const canRead = [
    ...authGuard,
    requirePortalPermission("environment_access", "read"),
  ];
  const canCreate = [
    ...authGuard,
    requirePortalPermission("environment_access", "create"),
  ];
  const canUpdate = [
    ...authGuard,
    requirePortalPermission("environment_access", "update"),
  ];
  const canDelete = [
    ...authGuard,
    requirePortalPermission("environment_access", "delete"),
  ];

  /** Only the two API-access switches. is_active/is_visible are the
      Environments module's business, not this one's. */
  const GatesSchema = {
    schema: {
      body: {
        type: "object",
        required: ["env_id"],
        properties: {
          env_id: { type: "string", format: "uuid" },
          allowlist_check_enabled: { type: "boolean" },
          custom_field_check_enabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  };

  const ok = (reply, data, message) =>
    reply.code(200).send({ success: true, message, data });

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  const forbidden = (reply) =>
    reply.code(403).send({
      success: false,
      message: "You do not have access to this environment.",
    });

  /** True if this portal user may see envId — admin-role portal users see
      every environment, matching GetMyEnvironments' own admin bypass. */
  const ownsEnv = async (portalUser, envId) => {
    if (!envId) return false;
    if (portalUser.role === "admin") return true;

    const owned = await WrikeCredentials.GetByOwnerId(portalUser.id);
    return (owned || []).some((env) => env.id === envId);
  };

  /** The rule, or null after having already replied — the same
      "resolve the row, then check the caller owns its environment" step the
      read routes do, needed here because a rule id names no environment. */
  const loadOwnedRule = async (portalUser, ruleId, reply) => {
    const rule = await EnvironmentAccess.GetRuleById(ruleId);
    if (!rule) {
      reply
        .code(404)
        .send({ success: false, message: "Allow-list rule not found." });
      return null;
    }
    if (!(await ownsEnv(portalUser, rule.env_id))) {
      forbidden(reply);
      return null;
    }
    return rule;
  };

  fastify.get("/my-ip", { preHandler: canRead }, async (req, reply) =>
    ok(reply, { ip: clientIp(req) }),
  );

  fastify.get(
    "/rules",
    { ...EnvQuerySchema, preHandler: canRead },
    async (req, reply) => {
      try {
        if (!(await ownsEnv(req.portalUser, req.query.env_id))) {
          return forbidden(reply);
        }
        return ok(
          reply,
          await EnvironmentAccess.GetRulesByEnv(req.query.env_id),
        );
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // POST /portal/environment-access/rules
  fastify.post(
    "/rules",
    { ...CreateRuleSchema, preHandler: canCreate },
    async (req, reply) => {
      try {
        if (!(await ownsEnv(req.portalUser, req.body?.env_id))) {
          return forbidden(reply);
        }

        const rule = await EnvironmentAccess.CreateRule(null, req.body);

        return reply.code(201).send({
          success: true,
          message: "Allow-list entry added.",
          data: rule,
        });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // PUT /portal/environment-access/rules/:id
  fastify.put(
    "/rules/:id",
    { ...UpdateRuleSchema, preHandler: canUpdate },
    async (req, reply) => {
      try {
        if (!(await loadOwnedRule(req.portalUser, req.params.id, reply)))
          return;

        const rule = await EnvironmentAccess.UpdateRule(
          null,
          req.params.id,
          req.body,
        );

        return ok(reply, rule, "Allow-list entry updated.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // DELETE /portal/environment-access/rules/:id
  fastify.delete(
    "/rules/:id",
    { ...IdParamSchema, preHandler: canDelete },
    async (req, reply) => {
      try {
        if (!(await loadOwnedRule(req.portalUser, req.params.id, reply)))
          return;

        await EnvironmentAccess.DeleteRule(null, req.params.id);

        return ok(reply, null, "Allow-list entry removed.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // PATCH /portal/environment-access/gates — the two security switches.
  // The admin console flips these through its credentials route
  // (PATCH /admin/credentials/:id/status, src/routes/admin/credentials/
  // handlers/toggle.js); the portal gets its own because that route is behind
  // verifyAdminJWT and also carries is_active/is_visible.
  fastify.patch(
    "/gates",
    { ...GatesSchema, preHandler: canUpdate },
    async (req, reply) => {
      try {
        const { env_id, allowlist_check_enabled, custom_field_check_enabled } =
          req.body;

        if (!(await ownsEnv(req.portalUser, env_id))) {
          return forbidden(reply);
        }

        const updates = {};
        if (allowlist_check_enabled !== undefined) {
          updates.allowlist_check_enabled = allowlist_check_enabled;
        }
        if (custom_field_check_enabled !== undefined) {
          updates.custom_field_check_enabled = custom_field_check_enabled;
        }

        if (Object.keys(updates).length === 0) {
          return reply.code(400).send({
            success: false,
            message: "Provide at least one switch to update.",
          });
        }

        // WrikeCredentials.Update drops this environment's cached access scope
        // as part of the write, so a flipped gate is enforced on the very next
        // API/MCP call rather than up to a TTL later.
        const updated = await WrikeCredentials.Update(null, env_id, updates);
        await syncWrikeCredentialsFromDB();

        if (updated[0] <= 0) {
          return reply.code(400).send({
            success: false,
            message: "Update failed! Please try again.",
          });
        }

        return ok(reply, null, "Environment access gates updated.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.post(
    "/check",
    { ...CheckSchema, preHandler: canRead },
    async (req, reply) => {
      try {
        const { env_id, email, ip, surface } = req.body;

        if (!(await ownsEnv(req.portalUser, env_id))) {
          return forbidden(reply);
        }

        if (!email && !ip) {
          throw {
            statusCode: 400,
            message: "Provide an email, an IP, or both to check.",
          };
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
    },
  );

  done();
};

export default portalEnvironmentAccessRoute;
