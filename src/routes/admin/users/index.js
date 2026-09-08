import { verifyAdminJWT } from "../../../middlewares/adminAuth";
import { PortalAuth, PortalPermissions } from "../../../controllers";
import { catalog } from "../../../utils/portalPermissionCatalog";

import { ListUsers } from "../../portal/users/handlers/listUsers";
import { CreateUser } from "../../portal/users/handlers/createUser";
import { UpdateUser } from "../../portal/users/handlers/updateUser";
import { ResetPassword } from "../../portal/users/handlers/resetPassword";
import { ToggleUser } from "../../portal/users/handlers/toggleUser";
import { GenerateCredentials } from "../../portal/users/handlers/generateCredentials";
import {
  AssignEnv,
  RevokeEnv,
} from "../../portal/users/handlers/manageEnvironments";

import {
  CreateUserSchema,
  ResetPasswordSchema,
  ToggleUserSchema,
  AssignEnvSchema,
  RevokeEnvSchema,
} from "../../portal/users/schema";

// Admin-facing portal user management — uses verifyAdminJWT (admin_users token).
export const adminPortalUsersRoute = (fastify, opts, done) => {
  const guard = { preHandler: [verifyAdminJWT] };

  // GET /admin/portal-users
  fastify.get("/", guard, async (req, reply) => {
    try {
      const result = await ListUsers();
      return reply.code(result?.statusCode || 200).send({
        success: true,
        message: result?.message,
        data: result?.data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // POST /admin/portal-users
  fastify.post("/", { ...CreateUserSchema, ...guard }, async (req, reply) => {
    try {
      const result = await CreateUser(req.adminUser, req.body);
      return reply.code(result?.statusCode || 201).send({
        success: true,
        message: result?.message,
        data: result?.data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // POST /admin/portal-users/generate-credentials
  fastify.post("/generate-credentials", guard, async (req, reply) => {
    try {
      const result = await GenerateCredentials();
      return reply.code(result?.statusCode || 200).send({
        success: true,
        message: result?.message,
        data: result?.data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // PUT /admin/portal-users/:id/reset-password
  fastify.put(
    "/:id/reset-password",
    { ...ResetPasswordSchema, ...guard },
    async (req, reply) => {
      try {
        const result = await ResetPassword(req.adminUser, req.params, req.body);
        return reply.code(result?.statusCode || 200).send({
          success: true,
          message: result?.message,
        });
      } catch (err) {
        return reply.code(err?.statusCode || 400).send({
          success: false,
          message: err?.message || err,
        });
      }
    },
  );

  // PUT /admin/portal-users/:id/status
  fastify.put(
    "/:id/status",
    { ...ToggleUserSchema, ...guard },
    async (req, reply) => {
      try {
        const result = await ToggleUser(req.adminUser, req.params, req.body);
        return reply.code(result?.statusCode || 200).send({
          success: true,
          message: result?.message,
        });
      } catch (err) {
        return reply.code(err?.statusCode || 400).send({
          success: false,
          message: err?.message || err,
        });
      }
    },
  );

  // GET /admin/portal-users/permissions/catalog — the module vocabulary,
  // fetched once by the console rather than duplicated in the frontend.
  fastify.get("/permissions/catalog", guard, async (req, reply) => {
    return reply.code(200).send({ success: true, data: catalog() });
  });

  // GET /admin/portal-users/:id/permissions
  fastify.get("/:id/permissions", guard, async (req, reply) => {
    try {
      const data = await PortalPermissions.GetMatrix(req.params.id);
      return reply.code(200).send({ success: true, data });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // PUT /admin/portal-users/:id/permissions — replaces the whole matrix
  fastify.put("/:id/permissions", guard, async (req, reply) => {
    try {
      const data = await PortalPermissions.SetMatrix(
        req.adminUser.id,
        req.params.id,
        req.body?.permissions,
      );
      return reply.code(200).send({
        success: true,
        message: "Permissions updated.",
        data,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // GET /admin/portal-users/:id/environments
  fastify.get("/:id/environments", guard, async (req, reply) => {
    try {
      const envs = await PortalAuth.GetUserEnvironments(req.params.id);
      return reply.code(200).send({ success: true, data: envs });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // POST /admin/portal-users/:id/environments
  fastify.post(
    "/:id/environments",
    { ...AssignEnvSchema, ...guard },
    async (req, reply) => {
      try {
        const result = await AssignEnv(req.adminUser, req.params, req.body);
        return reply.code(result?.statusCode || 200).send({
          success: true,
          message: result?.message,
        });
      } catch (err) {
        return reply.code(err?.statusCode || 400).send({
          success: false,
          message: err?.message || err,
        });
      }
    },
  );

  // PUT /admin/portal-users/:id  (update profile — no password)
  fastify.put("/:id", guard, async (req, reply) => {
    try {
      const result = await UpdateUser(req.adminUser, req.params, req.body);
      return reply.code(result?.statusCode || 200).send({
        success: true,
        message: result?.message,
      });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  // DELETE /admin/portal-users/:id/environments?env_id=
  fastify.delete(
    "/:id/environments",
    { ...RevokeEnvSchema, ...guard },
    async (req, reply) => {
      try {
        const result = await RevokeEnv(req.params, req.query);
        return reply.code(result?.statusCode || 200).send({
          success: true,
          message: result?.message,
        });
      } catch (err) {
        return reply.code(err?.statusCode || 400).send({
          success: false,
          message: err?.message || err,
        });
      }
    },
  );

  done();
};
