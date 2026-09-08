import { GetAll } from "./handlers/getAll";
import { Save } from "./handlers/save";
import { Update } from "./handlers/update";
import { Toggle } from "./handlers/toggle";
import { Delete } from "./handlers/delete";

import { GetAllSchema } from "./schema/getAll";
import { SaveSchema } from "./schema/save";
import { UpdateSchema } from "./schema/update";
import { ToggleSchema } from "./schema/toggle";
import { DeleteSchema } from "./schema/delete";

import { verifyAdminJWT } from "../../../middlewares/adminAuth";

export const adminCredentialsRoute = (fastify, opts, done) => {
  // GET /admin/credentials  (protected)
  fastify.get(
    "/",
    { ...GetAllSchema, preHandler: [verifyAdminJWT] },
    async (req, reply) => {
      try {
        const result = await GetAll();

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
    },
  );

  // POST /admin/credentials  (protected)
  fastify.post(
    "/",
    { ...SaveSchema, preHandler: [verifyAdminJWT] },
    async (req, reply) => {
      try {
        const result = await Save({
          profile_id: req.adminUser?.id,
          ...req.body,
        });

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
    },
  );

  // PUT /admin/credentials/:id  (protected)
  fastify.put(
    "/:id",
    { ...UpdateSchema, preHandler: [verifyAdminJWT] },
    async (req, reply) => {
      try {
        const result = await Update(req.adminUser?.id, req.params, req.body);

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
    },
  );

  // PATCH /admin/credentials/:id/status  (protected) — flip is_active and/or
  // is_visible only, without resending the full credential form.
  fastify.patch(
    "/:id/status",
    { ...ToggleSchema, preHandler: [verifyAdminJWT] },
    async (req, reply) => {
      try {
        const result = await Toggle(req.adminUser?.id, req.params, req.body);

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
    },
  );

  // DELETE /admin/credentials/:id  (protected)
  fastify.delete(
    "/:id",
    { ...DeleteSchema, preHandler: [verifyAdminJWT] },
    async (req, reply) => {
      try {
        const result = await Delete(req.params);

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
