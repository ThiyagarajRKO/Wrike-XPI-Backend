import { Login } from "./handlers/login";
import { ChangePassword } from "./handlers/changePassword";
import { LoginSchema } from "./schema/login";
import { ChangePasswordSchema } from "./schema/changePassword";
import { verifyPortalJWT } from "../../../middlewares/portalAuth";
import { PortalPermissions } from "../../../controllers";
import { catalog } from "../../../utils/portalPermissionCatalog";

export const portalAuthRoute = (fastify, opts, done) => {
  // POST /portal/auth/login
  fastify.post("/login", LoginSchema, async (req, reply) => {
    try {
      const result = await Login(req.body);

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

  // POST /portal/auth/change-password  (protected — any portal user)
  fastify.post(
    "/change-password",
    { ...ChangePasswordSchema, preHandler: [verifyPortalJWT] },
    async (req, reply) => {
      try {
        const result = await ChangePassword(req.portalUser, req.body);

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

  // GET /portal/auth/permissions — the logged-in portal user's own module
  // matrix, so the portal UI can hide nav items and CRUD buttons it has no
  // access to. Every module comes back (an all-false matrix for a user with
  // no rows yet), the same guarantee GetMatrix already gives the admin
  // console — the frontend never has to tell "not configured" from "denied".
  fastify.get("/permissions", { preHandler: [verifyPortalJWT] }, async (req, reply) => {
    try {
      const data = await PortalPermissions.GetMatrix(req.portalUser.id);
      return reply.code(200).send({ success: true, data: { ...catalog(), permissions: data } });
    } catch (err) {
      return reply.code(err?.statusCode || 400).send({
        success: false,
        message: err?.message || err,
      });
    }
  });

  done();
};
