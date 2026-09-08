import { verifyAdminJWT } from "../../../middlewares/adminAuth";
import { ApiAccess } from "../../../controllers";
import {
  ACTIONS,
  customFieldName,
  invalidateEnvironment,
  isEnforced,
  simulateAccess,
} from "../../../utils/accessControl";

import {
  BulkCreateRulesSchema,
  CreateRuleSchema,
  EnvQuerySchema,
  IdParamSchema,
  SimulateSchema,
  UpdatePermissionSchema,
  UpdateRuleSchema,
  UpsertPermissionSchema,
  EMAIL_PATTERN,
  DOMAIN_PATTERN,
} from "./schema";

/**
 * Admin API behind /api/v1/admin/access — the console's control surface over
 * the two tables the request-path authorization reads
 * (src/utils/accessControl.js).
 *
 * Every write invalidates that environment's cached indexes before replying,
 * so a change an admin just made is live on the very next API call rather
 * than up to a TTL later. Doing it before the response is what lets the UI
 * promise "takes effect immediately" and mean it.
 */
export const adminAccessRoute = (fastify, opts, done) => {
  const guard = { preHandler: [verifyAdminJWT] };

  const ok = (reply, data, message) =>
    reply.code(200).send({ success: true, message, data });

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  /** Reject a value that doesn't look like what its rule_type claims. */
  const validateRuleValue = (ruleType, value) => {
    const pattern = new RegExp(
      ruleType === "domain" ? DOMAIN_PATTERN : EMAIL_PATTERN,
    );
    if (!pattern.test(String(value || "").trim())) {
      throw {
        statusCode: 400,
        message:
          ruleType === "domain"
            ? `"${value}" is not a valid domain. Use the bare domain, e.g. xtend.com`
            : `"${value}" is not a valid email address.`,
      };
    }
  };

  /* ── Console configuration ───────────────────────────────────────────── */

  // Lets the UI name the custom field and warn when enforcement is off,
  // rather than hard-coding "Xtend API" in the frontend and drifting from it.
  fastify.get("/config", guard, async (req, reply) =>
    ok(reply, {
      custom_field_name: customFieldName(),
      enforced: isEnforced(),
      actions: ACTIONS,
    }),
  );

  fastify.get("/summary", guard, async (req, reply) => {
    try {
      return ok(reply, await ApiAccess.GetSummary());
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* ── Allow list ──────────────────────────────────────────────────────── */

  fastify.get(
    "/rules",
    { ...EnvQuerySchema, ...guard },
    async (req, reply) => {
      try {
        return ok(reply, await ApiAccess.GetRulesByEnv(req.query.env_id));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.post(
    "/rules",
    { ...CreateRuleSchema, ...guard },
    async (req, reply) => {
      try {
        validateRuleValue(req.body.rule_type, req.body.value);

        const rule = await ApiAccess.CreateRule(req.adminUser.id, req.body);
        await invalidateEnvironment(rule.env_id);

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

  fastify.post(
    "/rules/bulk",
    { ...BulkCreateRulesSchema, ...guard },
    async (req, reply) => {
      try {
        const { env_id, entries } = req.body;

        const invalid = entries.find((entry) => {
          const pattern = new RegExp(
            entry?.rule_type === "domain" ? DOMAIN_PATTERN : EMAIL_PATTERN,
          );
          return !pattern.test(String(entry?.value || "").trim());
        });

        if (invalid) {
          throw {
            statusCode: 400,
            message: `"${invalid.value}" is not a valid ${
              invalid.rule_type === "domain" ? "domain" : "email address"
            }.`,
          };
        }

        const result = await ApiAccess.BulkCreateRules(
          req.adminUser.id,
          env_id,
          entries,
        );
        await invalidateEnvironment(env_id);

        return ok(
          reply,
          result,
          result.skipped.length
            ? `Added ${result.created}. Skipped ${result.skipped.length} already on the list.`
            : `Added ${result.created} to the allow list.`,
        );
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.put(
    "/rules/:id",
    { ...UpdateRuleSchema, ...guard },
    async (req, reply) => {
      try {
        if (req.body.value) {
          const existing = await ApiAccess.GetRuleById(req.params.id);
          validateRuleValue(existing?.rule_type, req.body.value);
        }

        const rule = await ApiAccess.UpdateRule(
          req.adminUser.id,
          req.params.id,
          req.body,
        );
        await invalidateEnvironment(rule.env_id);

        return ok(reply, rule, "Allow-list entry updated.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.delete(
    "/rules/:id",
    { ...IdParamSchema, ...guard },
    async (req, reply) => {
      try {
        const { env_id } = await ApiAccess.DeleteRule(
          req.adminUser.id,
          req.params.id,
        );
        await invalidateEnvironment(env_id);

        return ok(reply, null, "Allow-list entry removed.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /* ── Per-user permissions ────────────────────────────────────────────── */

  fastify.get(
    "/permissions",
    { ...EnvQuerySchema, ...guard },
    async (req, reply) => {
      try {
        return ok(reply, await ApiAccess.GetPermissionsByEnv(req.query.env_id));
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Emails already granted elsewhere — the console offers them as suggestions
  // so granting the same person in a second environment is one click.
  fastify.get("/permissions/known", guard, async (req, reply) => {
    try {
      return ok(reply, await ApiAccess.GetKnownEmails(req.query?.env_id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post(
    "/permissions",
    { ...UpsertPermissionSchema, ...guard },
    async (req, reply) => {
      try {
        const permission = await ApiAccess.UpsertPermission(
          req.adminUser.id,
          req.body,
        );
        await invalidateEnvironment(permission.env_id);

        return ok(reply, permission, `Access saved for ${permission.email}.`);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.put(
    "/permissions/:id",
    { ...UpdatePermissionSchema, ...guard },
    async (req, reply) => {
      try {
        const permission = await ApiAccess.UpdatePermission(
          req.adminUser.id,
          req.params.id,
          req.body,
        );
        await invalidateEnvironment(permission.env_id);

        return ok(reply, permission, "Permissions updated.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  fastify.delete(
    "/permissions/:id",
    { ...IdParamSchema, ...guard },
    async (req, reply) => {
      try {
        const { env_id } = await ApiAccess.DeletePermission(
          req.adminUser.id,
          req.params.id,
        );
        await invalidateEnvironment(env_id);

        return ok(reply, null, "Per-user access removed.");
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /* ── Simulator ───────────────────────────────────────────────────────── */

  fastify.post(
    "/simulate",
    { ...SimulateSchema, ...guard },
    async (req, reply) => {
      try {
        const result = await simulateAccess({
          envId: req.body.env_id,
          email: req.body.email,
        });

        return ok(reply, result);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  done();
};
