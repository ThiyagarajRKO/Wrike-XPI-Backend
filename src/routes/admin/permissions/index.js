import { verifyAdminJWT } from "../../../middlewares/adminAuth";
import { PortalPermissions } from "../../../controllers";
import { catalog } from "../../../utils/permissionCatalog";

/**
 * Module-level RBAC for portal users, behind /api/v1/admin/permissions.
 *
 * The catalog endpoint exists so the console never hard-codes its own copy of
 * the module or role list — add a module in src/utils/permissionCatalog.js and
 * the matrix grows a row without a frontend change.
 */
export const adminPermissionsRoute = (fastify, opts, done) => {
  const guard = { preHandler: [verifyAdminJWT] };

  const fail = (reply, err) =>
    reply.code(err?.statusCode || 400).send({
      success: false,
      message: err?.message || err || "Request failed",
    });

  const MatrixBodySchema = {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["permissions"],
        properties: {
          // Free-form on purpose: normaliseMatrix() in the catalog is the
          // real validator, and it discards anything not in the vocabulary
          // rather than trusting a schema that would have to be regenerated
          // every time a module is added.
          permissions: { type: "object", additionalProperties: true },
        },
      },
    },
  };

  // GET /admin/permissions/catalog
  fastify.get("/catalog", guard, async (req, reply) =>
    reply.code(200).send({ success: true, data: catalog() }),
  );

  // GET /admin/permissions/users/:id  — the unified "what can this person do"
  fastify.get("/users/:id", guard, async (req, reply) => {
    try {
      const data = await PortalPermissions.GetUserAccessSummary(req.params.id);
      return reply.code(200).send({ success: true, data });
    } catch (err) {
      return fail(reply, err);
    }
  });

  // PUT /admin/permissions/users/:id — replace the whole matrix
  fastify.put(
    "/users/:id",
    { ...MatrixBodySchema, ...guard },
    async (req, reply) => {
      try {
        const data = await PortalPermissions.SetMatrix(
          req.adminUser.id,
          req.params.id,
          req.body.permissions,
        );
        return reply.code(200).send({
          success: true,
          message: "Permissions updated.",
          data,
        });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // POST /admin/permissions/overview — matrices for many users in one call,
  // so the Permissions table doesn't fan out into one request per row.
  fastify.post("/overview", guard, async (req, reply) => {
    try {
      const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
      const data = await PortalPermissions.GetMatrixForUsers(ids);
      return reply.code(200).send({ success: true, data });
    } catch (err) {
      return fail(reply, err);
    }
  });

  done();
};
